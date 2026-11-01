/** Building blocks the popup screens share: layout, tabs, chips, prompts, progress. */
import qrcode from 'qrcode-generator'
import type { NetworkId } from '../shared/networks'
import type { Job, UiMessage } from '../shared/protocol'
import { h, send, topBar } from '../shared/ui'

export interface State {
  hasWallet: boolean
  unlocked: boolean
  address: string | null
  network: NetworkId
  origins: string[]
  cardLabels: Record<string, string>
  autoLockMin: number
  job: Job | null
  notify: boolean
}

/** The service worker's view of the wallet, refreshed on every navigation that needs it. */
export const ctx = { s: null as unknown as State }
export async function refresh(): Promise<State> {
  ctx.s = await send<State>({ type: 'state' })
  return ctx.s
}

export const root = document.getElementById('app')!

// Scanners and watchers a screen started; stopped as soon as another screen mounts.
const cleanups: (() => void)[] = []
export const onLeave = (fn: () => void) => { cleanups.push(fn) }
export function mount(...nodes: HTMLElement[]) {
  for (const fn of cleanups.splice(0)) { try { fn() } catch { /* already stopped */ } }
  root.replaceChildren(...nodes)
}

export const btn = (label: string, cls: string, onclick: (e: Event) => void, extra: Record<string, string> = {}) =>
  h('button', { class: `btn ${cls}`, type: 'button', onclick, ...extra }, label) as HTMLButtonElement

export const back = (to: () => void) => btn('Back', 'sm', to)
export const spacer = () => h('div', { style: 'flex:1' })

export const xlm = (n: number, digits = 7) => `${n.toLocaleString(undefined, { maximumFractionDigits: digits })} XLM`
export const when = (d: Date | string) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export type Tab = 'wallet' | 'pay' | 'cards' | 'agents' | 'activity' | 'settings'
const TABS: [Tab, string][] = [['wallet', 'Wallet'], ['pay', 'Pay'], ['cards', 'Cards'], ['agents', 'Agents'], ['activity', 'Activity'], ['settings', 'Settings']]

/** Set by popup.ts: opens a tab's first screen. */
export const nav = { tab: (_t: Tab): void => {} }

type Kid = Node | null | false | undefined

/** A screen inside the tabbed app: header, scrolling body, tab bar. */
export function screen(opts: { tab: Tab; right?: Kid[]; body: Kid[] }) {
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Sections' },
    ...TABS.map(([t, label]) => h('button', {
      type: 'button', class: t === opts.tab ? 'on' : '', 'aria-current': t === opts.tab ? 'page' : undefined,
      onclick: () => nav.tab(t),
    }, label)))
  mount(h('div', { class: 'app tabbed' }, topBar(...(opts.right ?? [])), h('main', { class: 'main scroll' }, ...opts.body), tabs))
}

/** A step outside the tab bar (forms, confirmations, results). */
export function page(opts: { left?: Kid; body: Kid[]; foot?: Kid[] }) {
  mount(h('div', { class: 'app' }, topBar(opts.left),
    h('main', { class: 'main scroll' }, ...opts.body),
    opts.foot ? h('footer', { class: 'foot row' }, ...opts.foot) : null))
}

export function field(label: string, control: HTMLElement, hint?: string | HTMLElement) {
  return h('div', { class: 'field' }, h('label', {}, label), control,
    hint ? (typeof hint === 'string' ? h('p', { class: 'small muted' }, hint) : hint) : null)
}

export const input = (attrs: Record<string, string>) => h('input', { autocomplete: 'off', spellcheck: 'false', ...attrs }) as HTMLInputElement

/** Single-choice chips; returns the element and a getter. */
export function chips<T>(options: { label: string; value: T }[], initial: T, onChange?: (v: T) => void) {
  let value = initial
  const el = h('div', { class: 'chips', role: 'radiogroup' })
  const draw = () => el.replaceChildren(...options.map((o) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(o.value === value), class: o.value === value ? 'chip on' : 'chip',
    onclick: () => { value = o.value; draw(); onChange?.(value) },
  }, o.label)))
  draw()
  return { el, get: () => value }
}

export const pill = (text: string, tone: '' | 'ok' | 'warn' | 'bad' = '') => h('span', { class: `pill ${tone}` }, text)

export function kv(rows: ([string, string | Node, boolean?] | null | false)[]) {
  return h('dl', { class: 'kv card' }, ...rows.filter((r): r is [string, string | Node, boolean?] => !!r).flatMap(([k, v, mono]) =>
    [h('dt', {}, k), h('dd', { class: mono ? 'mono' : '' }, v)]))
}

export function copyBtn(text: string, label = 'Copy') {
  const b = btn(label, 'sm', async () => {
    await navigator.clipboard.writeText(text)
    b.textContent = 'Copied'
    setTimeout(() => (b.textContent = label), 1400)
  })
  return b
}

export const explorerLink = (base: string, path: string, label = 'View on StellarExpert') =>
  h('a', { class: 'btn sm', href: `${base}/${path}`, target: '_blank', rel: 'noopener' }, label)

/** "Are you sure?" as its own step, since a popup can't lean on window.confirm. */
export function confirmStep(opts: { title: string; body: (Node | string)[]; confirm: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  page({
    left: back(opts.onCancel),
    body: [h('h1', {}, opts.title), ...opts.body.map((b) => (typeof b === 'string' ? h('p', { class: 'muted' }, b) : b))],
    foot: [btn('Cancel', '', opts.onCancel), btn(opts.confirm, opts.danger ? 'danger' : 'gold', opts.onConfirm)],
  })
}

/**
 * Runs a wallet write in the service worker behind a progress screen, then
 * shows the outcome. The write keeps going if the popup closes; the Wallet
 * tab shows how it ended next time.
 */
export async function run(opts: { label: string; steps?: string[]; msg: UiMessage; done: () => void; explorer: string; receipt?: (r: { hash?: string; [k: string]: unknown }) => Receipt }) {
  const steps = opts.steps ?? ['Signing with your wallet', 'Waiting for Stellar to confirm']
  page({
    body: [
      h('div', { style: 'height:24px' }), h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Working' }),
      h('h1', { class: 'center' }, opts.label),
      h('ol', { class: 'steps' }, ...steps.map((s) => h('li', {}, s))),
      h('p', { class: 'small muted center' }, 'You can close this window. Noir keeps going and shows the result when you open it again.'),
    ],
  })
  try {
    const r = await send<{ hash?: string; message: string; [k: string]: unknown }>(opts.msg)
    if (opts.receipt) receipt({ ...opts.receipt(r), message: r.message }, opts.explorer, opts.done)
    else result({ ok: true, message: r.message, hash: r.hash, explorer: opts.explorer, done: opts.done })
  } catch (e) {
    result({ ok: false, message: (e as Error).message, explorer: opts.explorer, done: opts.done })
  }
}

export function result(r: { ok: boolean; message: string; hash?: string; explorer: string; done: () => void }) {
  page({
    body: [
      h('div', { style: 'height:24px' }),
      h('div', { class: `badge ${r.ok ? 'ok' : 'bad'}`, 'aria-hidden': 'true' }, r.ok ? '✓' : '!'),
      h('h1', { class: 'center' }, r.ok ? 'Done' : 'That didn’t go through'),
      h('p', { class: 'center muted', role: r.ok ? 'status' : 'alert' }, r.message),
      r.hash ? h('div', { class: 'center' }, explorerLink(r.explorer, `tx/${r.hash}`)) : null,
      r.ok ? null : h('p', { class: 'small muted center' }, 'Each step is checked before it runs, so trying again is safe.'),
    ],
    foot: [btn(r.ok ? 'Done' : 'Back', 'gold', r.done)],
  })
}

/** What a receipt shows (frontend/src/screens/ReceiptScreen.tsx). */
export interface Receipt {
  title: string
  amount: number
  direction: 'in' | 'out'
  status: 'confirmed' | 'pending'
  counterpartyLabel?: string
  counterparty?: string
  note?: string
  message?: string
  /** Transactions, labelled, e.g. [['Authorize', hash], ['Claim', hash]]. */
  txs?: [string, string][]
  at?: Date
}

export function receipt(r: Receipt, explorer: string, done: () => void) {
  const at = r.at ?? new Date()
  const text = [
    `Noir receipt: ${r.title}`,
    `${r.direction === 'in' ? '+' : '−'}${r.amount} XLM (${r.status})`,
    r.counterparty ? `${r.counterpartyLabel ?? 'Account'}: ${r.counterparty}` : '',
    r.note ?? '',
    when(at),
    ...(r.txs ?? []).map(([k, v]) => `${k}: ${v}`),
  ].filter(Boolean).join('\n')
  page({
    body: [
      h('div', { style: 'height:12px' }),
      h('div', { class: 'badge ok', 'aria-hidden': 'true' }, '✓'),
      h('p', { class: 'kicker center' }, r.title),
      h('div', { class: `balance center amt ${r.direction}` }, `${r.direction === 'in' ? '+' : '−'}${r.amount.toLocaleString(undefined, { maximumFractionDigits: 7 })}`, h('small', {}, 'XLM')),
      h('div', { class: 'center' }, pill(r.status === 'confirmed' ? 'Confirmed' : 'Waiting for the merchant to claim', r.status === 'confirmed' ? 'ok' : 'warn')),
      r.message ? h('p', { class: 'center muted', role: 'status' }, r.message) : null,
      kv([
        r.counterparty ? [r.counterpartyLabel ?? 'Account', r.counterparty, true] : null,
        r.note ? ['Note', r.note] : null,
        ['When', when(at)],
        ...(r.txs ?? []).map(([k, v]): [string, string, boolean] => [k, v, true]),
      ]),
      h('div', { class: 'row' }, copyBtn(text, 'Copy receipt'),
        ...(r.txs ?? []).slice(-1).map(([, v]) => explorerLink(explorer, `tx/${v}`, 'Explorer'))),
    ],
    foot: [btn('Done', 'gold', done)],
  })
}

/** QR code as SVG, built through the DOM rather than parsed markup. */
export function qr(text: string, size = 196): SVGElement {
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  const n = q.getModuleCount()
  const m = 2
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  for (const [k, v] of Object.entries({ viewBox: `0 0 ${n + m * 2} ${n + m * 2}`, width: `${size}`, height: `${size}`, role: 'img', 'aria-label': 'QR code', 'shape-rendering': 'crispEdges' })) svg.setAttribute(k, v)
  const bg = document.createElementNS(NS, 'rect')
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#fff')
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`
  const path = document.createElementNS(NS, 'path')
  path.setAttribute('d', d); path.setAttribute('fill', '#0A0A0A')
  svg.append(bg, path)
  return svg
}
