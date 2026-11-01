import { generateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { busy, h, send, topBar } from '../shared/ui'
import { back, btn, chips, field, mount, page, spacer } from './kit'

/** Called after the wallet is created, imported or unlocked. */
let enter: () => void = () => {}
export const onEntered = (fn: () => void) => { enter = fn }

const shuffle = <T>(a: T[]) => {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const wordGrid = (mnemonic: string) => h('div', { class: 'words' }, ...mnemonic.split(' ').map((w, i) => h('span', {}, h('i', {}, `${i + 1}`), w)))

export function onboarding() {
  mount(h('div', { class: 'app' }, topBar(),
    h('main', { class: 'main' },
      h('p', { class: 'kicker' }, 'Tap into trust'),
      h('h1', {}, 'Your Stellar wallet, in the browser.'),
      h('p', { class: 'muted' }, 'Send and receive XLM, link and fund Noir tap-to-pay cards, manage their agents, and sign for Stellar apps. Use the same recovery phrase as the Noir app to open the same wallet and cards.'),
      spacer(),
      btn('Create a new wallet', 'gold block', () => createFlow()),
      btn('I already have a recovery phrase', 'block', () => importFlow()),
    )))
}

function passwordStep(mnemonic: string, onBack: () => void) {
  const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' }) as HTMLInputElement
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat it' }) as HTMLInputElement
  const err = h('p', { class: 'err', role: 'alert' })
  const go = btn('Create wallet', 'gold block', async () => busy(go, err, async () => {
    if (pw.value.length < 8) throw new Error('Use at least 8 characters.')
    if (pw.value !== pw2.value) throw new Error('The passwords don’t match.')
    await send({ type: 'create', password: pw.value, mnemonic })
    enter()
  }))
  pw2.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click() })
  page({
    left: back(onBack),
    body: [
      h('h1', {}, 'Set a password'),
      h('p', { class: 'muted' }, 'It unlocks Noir on this browser. Your phrase is encrypted with it and never leaves this device.'),
      field('Password', pw), field('Confirm password', pw2), err, spacer(), go,
    ],
  })
  pw.focus()
}

function createFlow(mnemonic = generateMnemonic(wordlist, 128)) {
  const saved = h('input', { type: 'checkbox', id: 'saved' }) as HTMLInputElement
  const next = btn('Continue', 'gold block', () => verifyStep(mnemonic), { disabled: '' })
  saved.addEventListener('change', () => { next.disabled = !saved.checked })
  page({
    left: back(onboarding),
    body: [
      h('h1', {}, 'Your recovery phrase'),
      h('p', { class: 'muted' }, 'Write these 12 words down in order. Anyone with them controls your funds; Noir can’t recover them for you.'),
      wordGrid(mnemonic),
      h('label', { class: 'check', for: 'saved' }, saved, 'I wrote my recovery phrase down somewhere safe.'),
      spacer(), next,
    ],
  })
}

/** Like the app: pick the right word for four random positions. */
function verifyStep(mnemonic: string) {
  const words = mnemonic.split(' ')
  const positions = shuffle([...words.keys()]).slice(0, 4).sort((a, b) => a - b)
  const err = h('p', { class: 'err', role: 'alert' })
  const pickers = positions.map((i) => {
    const decoys = shuffle([...new Set(words.filter((w) => w !== words[i]))]).slice(0, 3)
    return { i, c: chips(shuffle([words[i], ...decoys]).map((w) => ({ label: w, value: w })), '') }
  })
  const go = btn('Confirm', 'gold block', () => {
    if (pickers.some(({ i, c }) => c.get() !== words[i])) { err.textContent = 'Not quite. Check your written phrase and try again.'; return }
    passwordStep(mnemonic, () => createFlow(mnemonic))
  })
  page({
    left: back(() => createFlow(mnemonic)),
    body: [
      h('h1', {}, 'Check your phrase'),
      h('p', { class: 'muted' }, 'Pick the right word for each position.'),
      ...pickers.map(({ i, c }) => field(`Word #${i + 1}`, c.el)),
      err, spacer(), go,
    ],
  })
}

function importFlow() {
  const phrase = h('textarea', { placeholder: '12 or 24 words, separated by spaces', spellcheck: 'false', autocomplete: 'off' }) as HTMLTextAreaElement
  const err = h('p', { class: 'err', role: 'alert' })
  const next = btn('Continue', 'gold block', () => {
    const words = phrase.value.trim().split(/\s+/)
    if (![12, 15, 18, 21, 24].includes(words.length)) { err.textContent = 'A recovery phrase has 12 or 24 words.'; return }
    passwordStep(words.join(' ').toLowerCase(), importFlow)
  })
  page({
    left: back(onboarding),
    body: [
      h('h1', {}, 'Import a wallet'),
      h('p', { class: 'muted' }, 'Enter the recovery phrase from the Noir app (or any SEP-5 Stellar wallet). Your cards and their agents come with it.'),
      field('Recovery phrase', phrase), err, spacer(), next,
    ],
  })
  phrase.focus()
}

export function unlockScreen() {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Wallet password', 'aria-label': 'Wallet password' }) as HTMLInputElement
  const err = h('p', { class: 'err', role: 'alert' })
  const go = btn('Unlock', 'gold block', () => busy(go, err, async () => { await send({ type: 'unlock', password: pw.value }); enter() }))
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click() })
  mount(h('div', { class: 'app' }, topBar(),
    h('main', { class: 'main center' },
      h('div', { style: 'height:24px' }),
      h('img', { src: 'logo.png', alt: '', width: '72', height: '72', style: 'margin:0 auto' }),
      h('h1', {}, 'Welcome back'),
      h('p', { class: 'muted' }, 'Enter your wallet password to unlock.'),
      pw, err, spacer(), go,
    )))
  pw.focus()
}
