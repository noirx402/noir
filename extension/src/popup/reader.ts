/**
 * Reading a Noir card in the browser. Chrome has three ways in, and the
 * reader screen listens on all of them at once:
 *
 *  - Web NFC (NDEFReader): Chrome on Android, where the phone's radio reads
 *    the tag's serial number.
 *  - A USB NFC reader in keyboard mode: the common desktop reader types the
 *    UID and Enter when a card touches it. Desktop Chrome has no NFC API, so
 *    this is how a laptop reads a card. Keystrokes that arrive faster than a
 *    person types are taken as the reader, in the format chosen in Settings.
 *  - Typing the UID (from any NFC app), hashed exactly as the app does.
 */
import { deviceHashOf, normalizeUid, uidFromReader, type ReaderFormat } from '../shared/noir'
import { busy, h } from '../shared/ui'
import { back, btn, field, input, onLeave, page } from './kit'

interface NdefReader {
  scan(o?: { signal?: AbortSignal }): Promise<void>
  onreading: ((e: { serialNumber: string }) => void) | null
  onreadingerror: (() => void) | null
}
const NDEFReaderCtor = (globalThis as { NDEFReader?: new () => NdefReader }).NDEFReader

/** Web NFC exists only where the browser has an NFC radio (Chrome on Android). */
export const canScanNfc = () => !!NDEFReaderCtor

const FORMAT_KEY = 'readerFormat'
export async function readerFormat(): Promise<ReaderFormat> {
  try { return ((await chrome.storage.local.get(FORMAT_KEY))[FORMAT_KEY] as ReaderFormat | undefined) ?? 'hex' } catch { return 'hex' }
}
export const setReaderFormat = (f: ReaderFormat) => chrome.storage.local.set({ [FORMAT_KEY]: f })

/** Average gap between keystrokes below which they came from a reader, not a person. */
const READER_GAP_MS = 35

/** Listens to Web NFC until `signal` aborts; restarts after a bad read. */
function listenNfc(signal: AbortSignal, onUid: (serial: string) => void, onError: (msg: string) => void) {
  if (!NDEFReaderCtor) return
  const r = new NDEFReaderCtor()
  r.onreading = (e) => onUid(e.serialNumber)
  r.onreadingerror = () => onError('The card couldn’t be read. Hold it still against the phone and try again.')
  r.scan({ signal }).catch((e: Error) => {
    if (signal.aborted) return
    onError(e?.name === 'NotAllowedError' ? 'NFC permission was refused. Allow NFC for Noir, or type the UID.' : `NFC isn’t available: ${e?.message ?? e}`)
  })
}

const nfcGlyph = () => {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', '#C6A15B')
  svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('aria-hidden', 'true')
  for (const d of ['M6 8.5a5 5 0 0 1 0 7', 'M9.5 6a8.5 8.5 0 0 1 0 12', 'M13 3.5a12 12 0 0 1 0 17']) {
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p)
  }
  return svg
}

export interface ReadCardOpts {
  kicker?: string
  title: string
  hint: string
  /** Shown above the reader, e.g. the amount being charged. */
  top?: (Node | null)[]
  onCancel: () => void
  /**
   * Called with each card read. Throw to show the reason and keep listening
   * (tap another card); otherwise it navigates on.
   */
  accept: (uid: string, deviceHash: string) => Promise<void>
}

export function readCard(o: ReadCardOpts) {
  const uid = input({ placeholder: '04:A2:B3:C4:D5:E6:80', 'aria-label': 'Card UID' })
  const err = h('p', { class: 'err', role: 'alert' })
  const status = h('p', { class: 'small muted center', 'aria-live': 'polite' }, o.hint)
  const ctl = new AbortController()
  onLeave(() => ctl.abort())
  let working = false
  let format: ReaderFormat = 'hex'
  void readerFormat().then((f) => { format = f })

  const take = async (raw: string, from: 'nfc' | 'reader' | 'typed') => {
    if (working) return
    working = true
    err.textContent = ''
    try {
      const id = from === 'reader' ? uidFromReader(raw, format) : normalizeUid(raw)
      status.textContent = 'Card read. Checking it on Stellar…'
      await o.accept(id, await deviceHashOf(id))
    } catch (e) {
      err.textContent = (e as Error).message
      status.textContent = 'Tap another card, or try again.'
      uid.select()
    } finally {
      working = false
    }
  }

  // Keyboard-mode readers type into whatever has focus: keep it on the UID field.
  let stamps: number[] = []
  uid.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const n = stamps.length
      const fast = n >= 7 && (stamps[n - 1] - stamps[0]) / (n - 1) < READER_GAP_MS
      stamps = []
      if (uid.value.trim()) void take(uid.value, fast ? 'reader' : 'typed')
      return
    }
    if (e.key.length === 1) stamps.push(e.timeStamp)
  })
  uid.addEventListener('input', () => { if (!uid.value) stamps = [] })
  const refocus = (e: KeyboardEvent) => { if (document.activeElement !== uid && e.key.length === 1 && !(e.target as HTMLElement)?.closest?.('input,textarea')) uid.focus() }
  document.addEventListener('keydown', refocus, { capture: true })
  onLeave(() => document.removeEventListener('keydown', refocus, { capture: true }))

  const sources = h('ul', { class: 'sources' },
    h('li', {}, h('span', { class: `dot ${canScanNfc() ? 'on' : ''}`, 'aria-hidden': 'true' }),
      canScanNfc() ? 'Phone NFC: hold the card to the back of the phone' : 'Phone NFC: not in this browser (Chrome on Android has it)'),
    h('li', {}, h('span', { class: 'dot on', 'aria-hidden': 'true' }), 'USB NFC reader (keyboard mode): touch the card to the reader'),
    h('li', {}, h('span', { class: 'dot on', 'aria-hidden': 'true' }), 'Or type the UID from any NFC app and press Enter'))

  const go = btn('Continue', 'gold', () => busy(go, err, async () => { if (uid.value.trim()) await take(uid.value, 'typed'); else err.textContent = 'Tap a card or type its UID.' }))

  page({
    left: back(o.onCancel),
    body: [
      o.kicker ? h('p', { class: 'kicker' }, o.kicker) : null,
      h('h1', {}, o.title),
      ...(o.top ?? []),
      h('div', { class: 'reader' }, h('div', { class: 'ring' }, nfcGlyph()), status),
      err,
      sources,
      field('Card UID', uid, 'An NTAG213 UID is 7 bytes. Colons are optional.'),
    ],
    foot: [btn('Cancel', '', o.onCancel), go],
  })
  uid.focus()
  listenNfc(ctl.signal, (serial) => { uid.value = serial; void take(serial, 'nfc') }, (m) => { err.textContent = m })
}
