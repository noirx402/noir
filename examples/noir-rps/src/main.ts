import './style.css'
import {
  fromStroops, NoirAgentClient, noirExtension, noirExtensionSigner, toStroops, type NoirAgentPolicy, type NoirSigner,
} from '@noirx402/agent-sdk'
import { commitment, MOVES, outcome, STAKES, stakeMemo, type Move, type Outcome } from './rules'
import { buildPayment, explorerTx, NETWORK_PASSPHRASE, submit, xlmBalance } from './stellar'

interface Round { roundId: string; commitment: string; house: string }
interface PlayResult {
  roundId: string; playerMove: Move; houseMove: Move; salt: string; commitment: string
  outcome: Outcome; stake: string; payout: string; payoutTx: string | null; payoutError?: string
}

const GLYPH: Record<Move, string> = { rock: '✊', paper: '✋', scissors: '✌️' }
const LABEL: Record<Outcome, string> = { win: 'You win', lose: 'House wins', draw: 'Draw' }
/** The native XLM contract on Testnet, so a card policy for it reads "XLM". */
const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

const noir = new NoirAgentClient() // Testnet contracts are built in
let signer: NoirSigner | null = null
let stake: string = STAKES[0]
let busy = false
const score = { win: 0, lose: 0, draw: 0 }

const $ = (id: string) => document.getElementById(id) as HTMLElement
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...kids)
  return node
}

function status(text: string, tone: 'info' | 'error' = 'info') {
  const s = $('status')
  s.textContent = text
  s.dataset.tone = tone
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json' } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `House returned ${res.status}`)
  return body as T
}

async function sign(xdr: string): Promise<string> {
  const out = await signer!.signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE })
  return typeof out === 'string' ? out : out.signedTxXdr
}

function friendly(e: unknown): string {
  const err = e as { code?: number; message?: string; response?: { data?: { extras?: { result_codes?: unknown } } } }
  if (err.code === -4) return 'You declined the request in Noir.'
  if (err.code === -1 && /locked/i.test(err.message ?? '')) return 'Unlock Noir and try again.'
  const codes = err.response?.data?.extras?.result_codes
  if (codes) return `Stellar refused the transaction: ${JSON.stringify(codes)}`
  return err.message ?? String(e)
}

// ---------- wallet ----------

async function connect() {
  try {
    status('Approve the connection in the Noir window…')
    signer = await noirExtensionSigner()
    status('Connected. Pick a stake and a move.')
    renderWallet()
    await Promise.all([refreshBalances(), loadCards()])
  } catch (e) {
    status(friendly(e), 'error')
  }
}

function renderWallet() {
  const box = $('wallet')
  box.replaceChildren()
  if (!noirExtension()) {
    box.append(
      el('p', { className: 'muted' }, 'The Noir extension is not installed in this browser.'),
      el('p', { className: 'muted small' }, 'Build it (extension/ → npm run build), load extension/dist in chrome://extensions, then reload this page.'),
    )
    return
  }
  if (!signer) {
    box.append(el('button', { className: 'primary', onclick: connect }, 'Connect Noir'))
    return
  }
  box.append(
    el('div', { className: 'row' },
      el('span', { className: 'label' }, 'Account'),
      el('a', { className: 'mono', href: `https://stellar.expert/explorer/testnet/account/${signer.publicKey}`, target: '_blank', rel: 'noreferrer', title: signer.publicKey }, short(signer.publicKey)),
    ),
    el('div', { className: 'row' }, el('span', { className: 'label' }, 'Balance'), el('span', { id: 'balance', className: 'mono' }, '…')),
    el('h3', {}, 'Your Noir cards'),
    el('ul', { id: 'cards', className: 'cards' }, el('li', { className: 'muted small' }, 'Reading the Noir contracts…')),
  )
}

async function refreshBalances() {
  const [mine, house] = await Promise.all([
    signer ? xlmBalance(signer.publicKey).catch(() => null) : null,
    api<{ address: string; balance: string }>('/api/house').catch(() => null),
  ])
  const b = document.getElementById('balance')
  if (b && mine !== null) b.textContent = `${fromStroops(mine)} XLM`
  if (house) {
    $('house').textContent = short(house.address)
    $('house').title = house.address
    $('house-balance').textContent = `${Number(fromStroops(house.balance)).toLocaleString()} XLM`
  } else {
    $('house').textContent = 'offline: run npm run dev'
  }
}

/** Lists the NFC cards this wallet linked in the Noir app, straight from the contracts. */
async function loadCards() {
  const list = document.getElementById('cards')
  if (!signer || !list) return
  try {
    const devices = await noir.listDevices(signer.publicKey)
    if (!devices.length) {
      list.replaceChildren(el('li', { className: 'muted small' }, 'No cards linked yet. Link one in the Noir app.'))
      return
    }
    const rows = await Promise.all(devices.map(async (hash) => {
      const [policy, escrow] = await Promise.all([noir.getPolicy(hash), noir.getEscrowBalance(hash)])
      return cardRow(hash, policy, escrow)
    }))
    list.replaceChildren(...rows)
  } catch (e) {
    list.replaceChildren(el('li', { className: 'muted small' }, `Couldn't read cards: ${friendly(e)}`))
  }
}

function cardRow(hash: string, policy: NoirAgentPolicy | null, escrow: bigint) {
  const asset = policy?.asset === XLM_SAC ? 'XLM' : policy ? short(policy.asset) : ''
  const cap = policy ? `${fromStroops(policy.maxAmount)} ${asset} per tap` : 'no spending policy'
  const expired = policy?.expiresAt && policy.expiresAt.getTime() < Date.now()
  return el('li', {},
    el('span', { className: 'mono' }, `Card ${hash.slice(0, 6)}`),
    el('span', {}, `${fromStroops(escrow)} XLM in escrow`),
    el('span', { className: expired ? 'warn' : 'muted' }, expired ? 'policy expired' : cap),
  )
}

// ---------- game ----------

async function play(move: Move) {
  if (busy) return
  if (!signer) return void status('Connect Noir first.', 'error')
  busy = true
  document.body.classList.add('busy')
  try {
    status('Dealing a round…')
    const round = await api<Round>('/api/round')
    $('commit').textContent = round.commitment

    status(`Approve the ${stake} XLM stake in the Noir window…`)
    const xdr = await buildPayment({ from: signer.publicKey, to: round.house, amount: toStroops(stake), memo: stakeMemo(round.roundId, move) })
    const signed = await sign(xdr)

    status('Sending your stake to Testnet…')
    const txHash = await submit(signed)

    status('The house is revealing its move…')
    const result = await api<PlayResult>('/api/play', { method: 'POST', body: JSON.stringify({ roundId: round.roundId, txHash }) })
    await showResult(result, txHash)
    if (result.payoutError) status(`The house owes you ${fromStroops(result.payout)} XLM but its payout failed: ${result.payoutError}`, 'error')
    else status('Play again?')
  } catch (e) {
    status(friendly(e), 'error')
  } finally {
    busy = false
    document.body.classList.remove('busy')
    refreshBalances()
  }
}

async function showResult(r: PlayResult, stakeTx: string) {
  // The house committed to sha256(round:move:salt) before we paid; check it kept its word.
  const fair = (await commitment(r.roundId, r.houseMove, r.salt)) === r.commitment && outcome(r.playerMove, r.houseMove) === r.outcome
  score[r.outcome]++
  $('score').textContent = `${score.win} W · ${score.lose} L · ${score.draw} D`

  const links = [el('a', { href: explorerTx(stakeTx), target: '_blank', rel: 'noreferrer' }, 'stake tx')]
  if (r.payoutTx) links.push(el('a', { href: explorerTx(r.payoutTx), target: '_blank', rel: 'noreferrer' }, 'payout tx'))

  $('result').replaceChildren(
    el('div', { className: 'duel' },
      el('div', {}, el('span', { className: 'glyph' }, GLYPH[r.playerMove]), el('small', {}, `You · ${r.playerMove}`)),
      el('span', { className: 'vs' }, 'vs'),
      el('div', {}, el('span', { className: 'glyph' }, GLYPH[r.houseMove]), el('small', {}, `House · ${r.houseMove}`)),
    ),
    el('p', { className: `verdict ${r.outcome}` }, LABEL[r.outcome]),
    el('p', { className: 'muted' }, r.outcome === 'lose' ? `−${fromStroops(r.stake)} XLM` : `+${fromStroops(r.payout)} XLM back`),
    el('p', { className: fair ? 'fair' : 'warn' }, fair ? '✓ Fair: the revealed move matches the commitment' : '✗ The reveal does not match the commitment'),
    el('p', { className: 'links' }, ...links),
  )
  $('history').prepend(el('li', {}, `${GLYPH[r.playerMove]} vs ${GLYPH[r.houseMove]}`, el('span', { className: r.outcome }, LABEL[r.outcome]), el('span', { className: 'muted' }, `${fromStroops(r.stake)} XLM`)))
}

function renderTable() {
  $('stakes').replaceChildren(...STAKES.map((s) => el('button', {
    className: `chip${s === stake ? ' on' : ''}`,
    onclick: () => { stake = s; renderTable() },
  }, `${s} XLM`)))
  $('moves').replaceChildren(...MOVES.map((m) => el('button', { className: 'move', onclick: () => play(m), ariaLabel: m },
    el('span', { className: 'glyph' }, GLYPH[m]), el('span', {}, m))))
}

renderTable()
renderWallet()
refreshBalances()
// The extension injects before the page runs; this covers a late injection.
window.addEventListener('noir#initialized', renderWallet)
