/**
 * Cards and Agents tabs: link a tag, fund and withdraw its escrow, top up its
 * agent, edit the agent's policy, unlink. Reads go straight to Soroban from
 * here; every write is signed in the service worker.
 */
import { NETWORKS } from '../shared/networks'
import {
  AGENT_TOPUP_XLM, DEFAULT_CAP_XLM, Noir, fromStroops, parseXlm, spendable, type CardSummary,
} from '../shared/noir'
import type { UiMessage } from '../shared/protocol'
import { busy, h, send, short } from '../shared/ui'
import {
  back, btn, chips, confirmStep, copyBtn, ctx, explorerLink, field, input, kv, page, pill, refresh, run, screen, spacer, when, xlm,
} from './kit'
import { readCard } from './reader'
import { balanceOf } from './wallet'

const TESTNET = NETWORKS.TESTNET
const LABELS = ['My Wallet Card', 'Daily Carry', 'Home Key']
const CAPS = [
  { label: 'Default', value: DEFAULT_CAP_XLM }, { label: '10 XLM', value: 10 }, { label: '25 XLM', value: 25 },
  { label: '50 XLM', value: 50 }, { label: '100 XLM', value: 100 }, { label: 'No cap', value: 0 },
]
const EXPIRY = [{ label: 'Never', value: 0 }, { label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 }]

export const noir = () => new Noir('TESTNET')
export const nameOf = (hash: string) => ctx.s.cardLabels[hash] ?? `Card ${hash.slice(0, 6).toUpperCase()}`
const agentKeys = () => send<Record<string, number>>({ type: 'agentKeys' }).catch(() => ({} as Record<string, number>))

function statusOf(c: CardSummary): { text: string; tone: '' | 'ok' | 'warn' | 'bad' } {
  if (!c.active) return { text: 'Revoked', tone: 'bad' }
  if (!c.policy) return { text: 'No agent', tone: 'warn' }
  if (c.policy.expiresAt && c.policy.expiresAt < new Date()) return { text: 'Expired', tone: 'warn' }
  return { text: 'Active', tone: 'ok' }
}
const capText = (c: CardSummary) => !c.policy ? '—' : c.policy.maxAmount === 0n ? 'No cap' : `${xlm(fromStroops(c.policy.maxAmount))} per tap`
const expiryText = (c: CardSummary) => !c.policy ? '—' : c.policy.expiresAt ? when(c.policy.expiresAt) : 'Never'

function testnetOnly(tab: 'cards' | 'agents'): boolean {
  if (ctx.s.network === 'TESTNET') return false
  screen({
    tab,
    body: [
      h('h1', {}, tab === 'cards' ? 'Noir cards' : 'Agents'),
      h('p', { class: 'muted' }, 'Noir’s card contracts run on Stellar Testnet. Switch to Testnet to link cards and manage their agents.'),
      btn('Switch to Testnet', 'gold block', async () => { await send({ type: 'setNetwork', network: 'TESTNET' }); await refresh(); void (tab === 'cards' ? cards() : agents()) }),
    ],
  })
  return true
}

async function loadCards(list: HTMLElement, row: (c: CardSummary) => HTMLElement, empty: string): Promise<CardSummary[]> {
  try {
    const all = await noir().cards(ctx.s.address!)
    list.replaceChildren(...(all.length ? all.map(row) : [h('li', {}, h('span', { class: 'muted small' }, empty))]))
    return all
  } catch {
    list.replaceChildren(h('li', {}, h('span', { class: 'muted small' }, 'Couldn’t reach Stellar to load your cards.')))
    return []
  }
}

const tapRow = (open: () => void, ...kids: (Node | null)[]) =>
  h('li', { class: 'tap', tabindex: '0', role: 'button', onclick: open, onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') open() } }, ...kids)

// ── Cards ───────────────────────────────────────────────────────────

export async function cards() {
  if (testnetOnly('cards')) return
  const list = h('ul', { class: 'list' }, h('li', {}, h('span', { class: 'muted small' }, 'Loading cards…')))
  screen({
    tab: 'cards',
    body: [
      h('div', { class: 'section-head' }, h('h1', {}, 'Noir cards'), btn('Link a card', 'gold sm', () => linkName())),
      h('p', { class: 'small muted' }, 'NFC cards linked to this wallet, read from Noir’s contracts. Cards linked on your phone show up here too.'),
      list,
    ],
  })
  await loadCards(list, (c) => {
    const st = statusOf(c)
    return tapRow(() => cardDetail(c.deviceHash),
      h('div', { class: 'grow' },
        h('div', {}, nameOf(c.deviceHash)),
        h('div', { class: 'small muted' }, `${xlm(fromStroops(c.escrow))} in escrow · ${capText(c)}`)),
      pill(st.text, st.tone))
  }, 'No cards linked yet.')
}

export async function cardDetail(deviceHash: string) {
  page({ left: back(cards), body: [h('p', { class: 'muted small' }, 'Loading…')] })
  let c: CardSummary
  try {
    c = await noir().card(deviceHash, ctx.s.address!)
  } catch {
    page({ left: back(cards), body: [h('p', { class: 'err' }, 'Couldn’t reach Stellar to load this card.')] })
    return
  }
  const st = statusOf(c)
  const escrow = fromStroops(c.escrow)
  const heldHere = !!c.agent && c.agent in (await agentKeys())

  page({
    left: back(cards),
    body: [
      h('div', { class: 'section-head' }, h('h1', {}, nameOf(deviceHash)), btn('Rename', 'sm', () => rename(deviceHash))),
      h('div', {}, pill(st.text, st.tone)),
      h('div', { class: 'card' }, h('p', { class: 'kicker' }, 'Escrow'),
        h('div', { class: 'balance' }, escrow.toLocaleString(undefined, { maximumFractionDigits: 7 }), h('small', {}, 'XLM')),
        h('p', { class: 'small muted' }, 'What the card’s agent can pay out by tap, within its policy.')),
      h('div', { class: 'row' },
        btn('Add funds', 'gold', () => amountStep({
          title: 'Add to escrow', caption: 'Moves XLM from your wallet into this card’s escrow contract.', confirm: 'Add funds', from: 'wallet',
          msg: (n) => ({ type: 'fundEscrow', deviceHash, amount: n }), onBack: () => cardDetail(deviceHash),
        }), c.active ? {} : { disabled: '' }),
        btn('Withdraw', '', () => amountStep({
          title: 'Withdraw from escrow', caption: `Up to ${xlm(escrow)} goes back to your wallet.`, confirm: 'Withdraw', max: escrow,
          msg: (n) => ({ type: 'withdrawEscrow', deviceHash, amount: n }), onBack: () => cardDetail(deviceHash),
        }), escrow > 0 ? {} : { disabled: '' })),
      kv([
        ['Per-tap limit', capText(c)],
        ['Expires', expiryText(c)],
        ['Agent', c.agent ? short(c.agent) : '—', true],
        ['Linked', c.createdAt ? when(c.createdAt) : '—'],
        ['Device hash', deviceHash, true],
      ]),
      c.agent ? btn('Agent and policy', 'block', () => agentDetail(deviceHash)) : null,
      c.agent && !heldHere ? h('p', { class: 'small muted' }, 'This card’s agent key isn’t from this recovery phrase, so its agent wallet can’t be swept from here.') : null,
      spacer(),
      btn('Unlink card', 'danger block', () => confirmStep({
        title: 'Unlink this card?',
        body: [
          'Noir revokes the card’s agent, returns its whole escrow to your wallet, removes the card from the device registry, then sends the agent wallet’s XLM back to you.',
          escrow > 0 ? h('p', { class: 'warning' }, `${xlm(escrow)} in escrow comes back to your wallet.`) : '',
          'The card stops paying straight away. You can link it again later.',
        ],
        confirm: 'Unlink', danger: true,
        onCancel: () => cardDetail(deviceHash),
        onConfirm: () => run({
          label: 'Unlinking card',
          steps: ['Revoking the agent', 'Returning the escrow', 'Removing the card from the registry', 'Sweeping the agent wallet'],
          msg: { type: 'unlinkCard', deviceHash }, explorer: TESTNET.explorer,
          done: async () => { await refresh(); void cards() },
        }),
      })),
    ],
  })
}

function rename(deviceHash: string) {
  const name = input({ value: nameOf(deviceHash), maxlength: '32', 'aria-label': 'Card name' })
  const err = h('p', { class: 'err', role: 'alert' })
  const save = btn('Save', 'gold', () => busy(save, err, async () => {
    await send({ type: 'setCardLabel', deviceHash, label: name.value })
    await refresh()
    void cardDetail(deviceHash)
  }))
  page({
    left: back(() => cardDetail(deviceHash)),
    body: [h('h1', {}, 'Rename card'), field('Name', name, 'Only stored in this browser. The chain knows cards by their hash.'), err],
    foot: [btn('Cancel', '', () => cardDetail(deviceHash)), save],
  })
  name.select()
}

/** Asks for an amount and runs `msg`. `from: 'wallet'` caps it at the spendable balance. */
export function amountStep(o: { title: string; caption: string; confirm: string; max?: number; from?: 'wallet'; msg: (n: number) => UiMessage; onBack: () => void }) {
  const amount = input({ inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount in XLM' })
  const avail = h('p', { class: 'small muted' }, o.max != null ? `${xlm(o.max)} available` : 'Checking your balance…')
  const err = h('p', { class: 'err', role: 'alert' })
  // The service worker re-checks the balance, so an unreadable one doesn't block here.
  const maxP = o.from === 'wallet'
    ? balanceOf(ctx.s.address!, 'TESTNET').then((a) => {
      const m = spendable(a.xlm, a.subentries)
      avail.textContent = `${xlm(m, 2)} available in your wallet after the network reserve`
      return m
    }, () => { avail.textContent = 'Couldn’t check your balance.'; return Infinity })
    : Promise.resolve(o.max ?? 0)
  const maxBtn = btn('Max', 'sm', async () => { const m = await maxP; if (m > 0 && m < Infinity) amount.value = String(Math.floor(m * 1e7) / 1e7) })
  const go = btn(o.confirm, 'gold', () => busy(go, err, async () => {
    const n = parseXlm(amount.value)
    const max = await maxP
    if (n > max) throw new Error(`Only ${xlm(max, 2)} is available.`)
    await run({ label: o.title, msg: o.msg(n), explorer: TESTNET.explorer, done: o.onBack })
  }))
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click() })
  page({
    left: back(o.onBack),
    body: [h('h1', {}, o.title), h('p', { class: 'muted' }, o.caption),
      field('Amount', h('div', { class: 'row', style: 'align-items:center' }, amount, maxBtn), avail), err],
    foot: [btn('Cancel', '', o.onBack), go],
  })
  amount.focus()
}

// ── Link a card ─────────────────────────────────────────────────────

export function linkName() {
  const custom = input({ placeholder: 'Or type a name', maxlength: '32', 'aria-label': 'Custom card name' })
  const pick = chips(LABELS.map((l) => ({ label: l, value: l })), LABELS[0], () => { custom.value = '' })
  const next = btn('Next', 'gold', () => linkUid(custom.value.trim() || pick.get()))
  custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') next.click() })
  page({
    left: back(cards),
    body: [
      h('p', { class: 'kicker' }, 'Link a card · 1 of 3'),
      h('h1', {}, 'Name this card'),
      h('p', { class: 'muted' }, 'Linking registers an NTAG213 card to this wallet on Stellar and gives it its own payment agent with a spending policy, the same way the Noir app does.'),
      field('Name', pick.el), custom,
    ],
    foot: [btn('Cancel', '', cards), next],
  })
}

function linkUid(label: string) {
  readCard({
    kicker: 'Link a card · 2 of 3',
    title: 'Tap the card',
    hint: 'Hold the NTAG213 card to your reader.',
    onCancel: linkName,
    accept: async (_uid, deviceHash) => {
      const own = await noir().ownership(deviceHash, ctx.s.address!)
      if (own.status === 'other') throw new Error(`This card is already linked to another wallet (${short(own.owner)}). Only that wallet can unlink it.`)
      if (own.status === 'mine' && !own.active) throw new Error('This card was revoked. Unlink it from its card page before linking it again.')
      if (own.status === 'mine' && (await noir().policy(deviceHash))) {
        confirmStep({
          title: 'Already linked', body: [`This card is already linked to this wallet as ${nameOf(deviceHash)}.`],
          confirm: 'Open card', onConfirm: () => cardDetail(deviceHash), onCancel: () => linkUid(label),
        })
        return
      }
      linkPolicy(label, deviceHash)
    },
  })
}

function linkPolicy(label: string, deviceHash: string) {
  const cap = chips(CAPS, DEFAULT_CAP_XLM)
  const exp = chips(EXPIRY, 0)
  page({
    left: back(() => linkUid(label)),
    body: [
      h('p', { class: 'kicker' }, 'Link a card · 3 of 3'),
      h('h1', {}, 'Agent policy'),
      h('p', { class: 'muted' }, 'The card’s agent can only pay within these limits, enforced on-chain by agent_registry. The default matches the app: 100,000 XLM per tap, never expires.'),
      field('Per-tap limit', cap.el), field('Expires', exp.el),
      kv([['Card', label], ['Device hash', `${deviceHash.slice(0, 16)}…`, true], ['Network', 'Stellar Testnet']]),
      h('p', { class: 'small muted' }, 'Two transactions: register the card, then authorize its agent.'),
    ],
    foot: [btn('Cancel', '', cards), btn('Link card', 'gold', () => run({
      label: `Linking ${label}`,
      steps: ['Picking a fresh agent key from your phrase', 'Registering the card (device_registry)', 'Authorizing its agent (agent_registry)'],
      msg: { type: 'linkCard', deviceHash, label, maxXlm: cap.get(), expiryDays: exp.get() },
      explorer: TESTNET.explorer,
      done: async () => { await refresh(); void cardDetail(deviceHash) },
    }))],
  })
}

// ── Agents ──────────────────────────────────────────────────────────

export async function agents() {
  if (testnetOnly('agents')) return
  const list = h('ul', { class: 'list' }, h('li', {}, h('span', { class: 'muted small' }, 'Loading agents…')))
  screen({
    tab: 'agents',
    body: [
      h('h1', {}, 'Agents'),
      h('p', { class: 'small muted' }, 'Each card has its own payment agent: a key from your recovery phrase that may pay only within the policy you set.'),
      list,
    ],
  })
  const rows = await loadCards(list, (c) => {
    const st = statusOf(c)
    const bal = h('span', {}, '…')
    if (c.agent) void balanceOf(c.agent, 'TESTNET').then((a) => { bal.textContent = a.exists ? xlm(a.xlm, 2) : 'not opened' }, () => { bal.textContent = '—' })
    return tapRow(() => agentDetail(c.deviceHash),
      h('div', { class: 'grow' },
        h('div', {}, nameOf(c.deviceHash), ' ', h('span', { class: 'mono small muted' }, c.agent ? short(c.agent) : '')),
        h('div', { class: 'small muted' }, capText(c), ' · wallet ', bal)),
      pill(st.text, st.tone))
  }, 'No agents yet. Link a card to create one.')
  if (rows.length === 0) list.append(h('li', {}, btn('Link a card', 'gold sm', () => linkName())))
}

export async function agentDetail(deviceHash: string) {
  page({ left: back(agents), body: [h('p', { class: 'muted small' }, 'Loading…')] })
  let c: CardSummary
  try {
    c = await noir().card(deviceHash, ctx.s.address!)
  } catch {
    page({ left: back(agents), body: [h('p', { class: 'err' }, 'Couldn’t reach Stellar to load this agent.')] })
    return
  }
  const st = statusOf(c)
  const [acct, keys] = await Promise.all([c.agent ? balanceOf(c.agent, 'TESTNET').catch(() => null) : null, agentKeys()])
  const index = keys[c.agent]
  const self = () => agentDetail(deviceHash)
  page({
    left: back(agents),
    body: [
      h('p', { class: 'kicker' }, `Agent for ${nameOf(deviceHash)}`),
      h('div', { class: 'balance' }, acct?.exists ? acct.xlm.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0', h('small', {}, 'XLM')),
      h('p', { class: 'small muted' }, acct?.exists
        ? 'In the agent’s own account. It pays the network fee each time the card taps (about 1–2.5 XLM on Testnet).'
        : `The agent’s account isn’t on the network yet. The first top-up opens it: ${AGENT_TOPUP_XLM} XLM covers the first taps’ network fees.`),
      h('div', {}, pill(st.text, st.tone)),
      kv([
        ['Address', c.agent || '—', true],
        ['Per-tap limit', capText(c)],
        ['Expires', expiryText(c)],
        ['Escrow', xlm(fromStroops(c.escrow))],
        ['Key', index ? `From this phrase (m/44'/148'/0'/${index}')` : 'Not from this phrase'],
      ]),
      c.agent ? h('div', { class: 'row' }, copyBtn(c.agent, 'Copy address'), explorerLink(TESTNET.explorer, `account/${c.agent}`, 'Explorer')) : null,
      h('div', { class: 'row' },
        btn('Top up agent', 'gold', () => amountStep({
          title: 'Top up agent', caption: 'Sends XLM from your wallet to the agent’s own account.', confirm: 'Top up', from: 'wallet',
          msg: (n) => ({ type: 'topUpAgent', deviceHash, amount: n }), onBack: self,
        }), c.agent && c.active ? {} : { disabled: '' }),
        btn('Edit policy', '', () => editPolicy(c), c.active ? {} : { disabled: '' })),
      btn('Open card', 'block', () => cardDetail(deviceHash)),
    ],
  })
}

function editPolicy(c: CardSummary) {
  const current = c.policy ? fromStroops(c.policy.maxAmount) : DEFAULT_CAP_XLM
  const cap = chips(CAPS.some((o) => o.value === current) ? CAPS : [...CAPS, { label: xlm(current), value: current }], current)
  const days = c.policy?.expiresAt ? Math.max(1, Math.round((c.policy.expiresAt.getTime() - Date.now()) / 86_400_000)) : 0
  const exp = chips(EXPIRY.some((o) => o.value === days) ? EXPIRY : [...EXPIRY, { label: `${days} days`, value: days }], days)
  const done = () => agentDetail(c.deviceHash)
  page({
    left: back(done),
    body: [
      h('h1', {}, 'Agent policy'),
      h('p', { class: 'muted' }, 'agent_registry won’t overwrite a policy, so Noir revokes the current one and registers the new one for the same agent. That takes two transactions.'),
      field('Per-tap limit', cap.el), field('Expires', exp.el, 'Counted from now.'),
    ],
    foot: [btn('Cancel', '', done), btn('Save policy', 'gold', () => run({
      label: 'Updating the policy',
      steps: ['Revoking the current policy', 'Registering the new policy'],
      msg: { type: 'setPolicy', deviceHash: c.deviceHash, maxXlm: cap.get(), expiryDays: exp.get() },
      explorer: TESTNET.explorer, done,
    }))],
  })
}
