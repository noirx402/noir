/**
 * The Pay tab, the app's "Tap to pay" (frontend/src/screens/MerchantPosScreen.tsx)
 * on payment_escrow:
 *
 *  - Charge: tap one of your cards; its agent authorizes the amount from the
 *    card's escrow to you, and you claim it straight away.
 *  - Pay by card: tap your card to pay a merchant from its escrow; the
 *    merchant claims it in their Noir wallet.
 *  - Send to card: tap someone's card and send XLM to its owner.
 *  - QR: a SEP-7 request that watches your account and shows the payment.
 *
 * Plus the claim box for card payments waiting for this wallet.
 */
import { NETWORKS } from '../shared/networks'
import { isAddress, matchIncoming, paymentUri, parsePaymentRequest, parseXlm, spendable, type PaymentRecord } from '../shared/noir'
import { busy, h, send } from '../shared/ui'
import { nameOf, noir } from './cards'
import {
  back, btn, chips, confirmStep, copyBtn, ctx, field, input, kv, onLeave, page, pill, qr, receipt, refresh, run, screen, xlm,
} from './kit'
import { scanQr } from './qrscan'
import { readCard } from './reader'
import { balanceOf } from './wallet'

export type PayMode = 'charge' | 'pay' | 'send' | 'qr'
const TESTNET = NETWORKS.TESTNET

const MODES: { label: string; value: PayMode; hint: string }[] = [
  { label: 'Charge', value: 'charge', hint: 'Tap one of your cards: its agent pays you from the card’s escrow.' },
  { label: 'Pay by card', value: 'pay', hint: 'Tap your card to pay a merchant from its escrow, within its policy.' },
  { label: 'Send to card', value: 'send', hint: 'Tap someone’s Noir card to send XLM to its owner.' },
  { label: 'QR', value: 'qr', hint: 'Show a payment request any Stellar wallet can scan.' },
]

export async function pay(mode: PayMode = 'charge', prefill: { amount?: string; merchant?: string } = {}) {
  if (ctx.s.network !== 'TESTNET') {
    screen({
      tab: 'pay',
      body: [
        h('h1', {}, 'Tap to pay'),
        h('p', { class: 'muted' }, 'Noir’s tap-to-pay contracts run on Stellar Testnet. Switch to Testnet to charge and pay with cards.'),
        btn('Switch to Testnet', 'gold block', async () => { await send({ type: 'setNetwork', network: 'TESTNET' }); await refresh(); void pay(mode, prefill) }),
      ],
    })
    return
  }
  const m = MODES.find((x) => x.value === mode)!
  const amount = input({ class: 'amount-in', inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount in XLM', value: prefill.amount ?? '' })
  const merchant = input({ placeholder: 'G… address or payment link', 'aria-label': 'Merchant address', value: prefill.merchant ?? '' })
  const err = h('p', { class: 'err', role: 'alert' })
  merchant.addEventListener('input', () => {
    const req = merchant.value.trim().toLowerCase().startsWith('web+stellar:') ? parsePaymentRequest(merchant.value) : null
    if (!req) return
    merchant.value = req.destination
    if (req.amount) amount.value = req.amount
  })
  const scanBtn = btn('Scan QR', 'sm', () => scanQr('pay', (r) => void pay('pay', { merchant: r.destination, amount: r.amount ?? amount.value }), () => void pay('pay', { amount: amount.value, merchant: merchant.value })))
  const modes = chips(MODES.map(({ label, value }) => ({ label, value })), mode, (v) => void pay(v, { amount: amount.value }))

  const go = btn(mode === 'qr' ? 'Show QR' : 'Tap card', 'gold block', () => busy(go, err, async () => {
    if (mode === 'qr') return showRequest(amount.value.trim() ? parseXlm(amount.value) : 0)
    const n = parseXlm(amount.value)
    if (mode === 'charge') return charge(n)
    if (mode === 'send') return sendToCard(n)
    const to = merchant.value.trim()
    if (!isAddress(to)) throw new Error('Enter the merchant’s Stellar address (G…), or scan their QR.')
    if (to === ctx.s.address) throw new Error('That is this wallet’s own address. Use Charge to pay yourself from a card.')
    payByCard(to, n)
  }))
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click() })

  const claims = h('div', {})
  screen({
    tab: 'pay',
    body: [
      h('h1', {}, 'Tap to pay'),
      modes.el,
      h('p', { class: 'small muted' }, m.hint),
      field(mode === 'qr' ? 'Amount (optional)' : 'Amount', h('div', { class: 'row', style: 'align-items:center' }, amount, h('span', { class: 'muted' }, 'XLM'))),
      mode === 'pay' ? field('Merchant', h('div', { class: 'row', style: 'align-items:center' }, merchant, scanBtn)) : null,
      err, go, claims,
    ],
  })
  amount.focus()
  void claimBox(claims)
}

/** Card payments waiting for this wallet in payment_escrow, with a Claim button. */
export async function claimBox(el: HTMLElement, onDone: () => void = () => void pay()) {
  let waiting = 0
  try { waiting = await noir().pendingClaims(ctx.s.address!) } catch { return }
  if (waiting <= 0) { el.replaceChildren(); return }
  el.replaceChildren(h('div', { class: 'card' },
    h('p', { class: 'kicker' }, 'Card payments to claim'),
    h('div', { class: 'balance' }, waiting.toLocaleString(undefined, { maximumFractionDigits: 7 }), h('small', {}, 'XLM')),
    h('p', { class: 'small muted' }, 'Paid to you by tapping a Noir card. It sits in Noir’s escrow until you claim it.'),
    btn('Claim', 'gold block', () => run({
      label: `Claiming ${xlm(waiting)}`, steps: ['Signing payment_escrow.claim', 'Waiting for Stellar to confirm'],
      msg: { type: 'claim' }, explorer: TESTNET.explorer, done: onDone,
      receipt: (r) => ({ title: 'Card payments claimed', amount: Number(r.xlm ?? waiting), direction: 'in', status: 'confirmed', note: 'From payment_escrow', txs: r.hash ? [['Claim', r.hash]] : [] }),
    }))))
}

/** Checks a tapped card is yours and can pay `n`; throws the reason it can't. */
async function myCard(deviceHash: string, n: number) {
  const own = await noir().ownership(deviceHash, ctx.s.address!)
  if (own.status === 'free') throw new Error('This card isn’t linked to any Noir wallet.')
  if (own.status === 'other') {
    throw new Error('This card belongs to another Noir wallet. Its agent key is on that wallet’s device, so it can’t pay from here. Ask them to pay with their card, or show them a QR.')
  }
  if (!own.active) throw new Error('This card was revoked and can’t pay.')
  const agent = (await noir().policy(deviceHash))?.agent ?? own.agent
  const refused = await noir().tapCheck(deviceHash, agent, n)
  if (refused) throw new Error(refused)
  const keys = await send<Record<string, number>>({ type: 'agentKeys' })
  if (!(agent in keys)) throw new Error('This card’s agent key isn’t from this recovery phrase, so it can’t pay from here.')
}

function charge(n: number) {
  const again = () => void pay('charge', { amount: String(n) })
  readCard({
    kicker: 'Charge', title: `Charge ${xlm(n)}`, hint: 'Hold the card to your reader.', onCancel: again,
    accept: async (_uid, deviceHash) => {
      await myCard(deviceHash, n)
      await run({
        label: `Charging ${xlm(n)}`,
        steps: ['The card’s agent signs payment_escrow.authorize', 'Claiming it into your wallet', 'Waiting for Stellar to confirm'],
        msg: { type: 'charge', deviceHash, amount: n }, explorer: TESTNET.explorer, done: () => void pay('charge'),
        receipt: (r) => ({
          title: 'Tap payment received', amount: n, direction: 'in', status: 'confirmed',
          counterpartyLabel: 'Card', counterparty: nameOf(deviceHash), note: 'Paid from the card’s escrow',
          txs: [['Authorize', String(r.authorizeHash)], ['Claim', String(r.claimHash)]],
        }),
      })
    },
  })
}

function payByCard(merchant: string, n: number) {
  const again = () => void pay('pay', { amount: String(n), merchant })
  readCard({
    kicker: 'Pay by card', title: `Pay ${xlm(n)}`, hint: 'Hold your card to the reader to pay.', onCancel: again,
    top: [kv([['To', merchant, true]])],
    accept: async (_uid, deviceHash) => {
      await myCard(deviceHash, n)
      confirmStep({
        title: `Pay ${xlm(n)} with ${nameOf(deviceHash)}?`,
        body: [
          kv([['To', merchant, true], ['From', `${nameOf(deviceHash)} escrow`], ['Network', 'Stellar Testnet']]),
          'The card’s agent reserves this amount for the merchant in Noir’s escrow. It can’t be taken back; the merchant claims it.',
        ],
        confirm: 'Pay', onCancel: again,
        onConfirm: () => run({
          label: `Paying ${xlm(n)}`, steps: ['The card’s agent signs payment_escrow.authorize', 'Waiting for Stellar to confirm'],
          msg: { type: 'payWithCard', deviceHash, merchant, amount: n }, explorer: TESTNET.explorer, done: () => void pay('pay'),
          receipt: (r) => ({
            title: 'Paid by card', amount: n, direction: 'out', status: 'pending', counterpartyLabel: 'To', counterparty: merchant,
            note: `Paid with ${nameOf(deviceHash)}`, txs: r.hash ? [['Authorize', r.hash]] : [],
          }),
        }),
      })
    },
  })
}

function sendToCard(n: number) {
  const again = () => void pay('send', { amount: String(n) })
  readCard({
    kicker: 'Send to card', title: `Send ${xlm(n)}`, hint: 'Hold their card to your reader.', onCancel: again,
    accept: async (_uid, deviceHash) => {
      const to = await noir().cardRecipient(deviceHash, ctx.s.address!)
      const a = await balanceOf(ctx.s.address!, 'TESTNET')
      const max = spendable(a.xlm, a.subentries)
      if (n > max) throw new Error(`You can send at most ${xlm(max, 2)} after the network reserve.`)
      const label = to.mine ? `${nameOf(deviceHash)}’s agent (your card)` : 'Card owner'
      confirmStep({
        title: `Send ${xlm(n)}?`,
        body: [kv([['To', label], ['Address', to.address, true], ['Network', 'Stellar Testnet']]), 'Stellar payments are final.'],
        confirm: 'Sign & send', onCancel: again,
        onConfirm: () => run({
          label: `Sending ${xlm(n)}`, msg: { type: 'send', destination: to.address, amount: n }, explorer: TESTNET.explorer, done: () => void pay('send'),
          receipt: (r) => ({
            title: 'Sent XLM', amount: n, direction: 'out', status: 'confirmed', counterpartyLabel: 'To', counterparty: to.address,
            note: `Paid by tapping ${to.mine ? nameOf(deviceHash) : 'their card'}`, txs: r.hash ? [['Payment', r.hash]] : [],
          }),
        }),
      })
    },
  })
}

// ── QR request that watches for the payment ─────────────────────────

async function showRequest(n: number) {
  const me = ctx.s.address!
  const net = NETWORKS[ctx.s.network]
  const uri = paymentUri({ destination: me, amount: n ? String(n) : undefined })
  const status = h('span', { class: 'small muted', 'aria-live': 'polite' }, 'Connecting to Stellar…')
  page({
    left: back(() => void pay('qr', { amount: n ? String(n) : '' })),
    body: [
      h('p', { class: 'kicker' }, 'Payment request'),
      h('div', { class: 'qr' }, qr(uri)),
      n ? h('div', { class: 'balance center' }, n.toLocaleString(undefined, { maximumFractionDigits: 7 }), h('small', {}, 'XLM')) : null,
      h('p', { class: 'center' }, h('span', { class: 'spinner sm', 'aria-hidden': 'true' }), ' ', status),
      h('p', { class: 'small muted center' }, 'Scan with Noir or any Stellar wallet.'),
      h('div', { class: 'row' }, copyBtn(uri, 'Copy payment link'), copyBtn(me, 'Copy address')),
      pill(ctx.s.network === 'PUBLIC' ? 'Mainnet' : 'Testnet', ctx.s.network === 'PUBLIC' ? 'warn' : ''),
    ],
  })

  let stopped = false
  onLeave(() => { stopped = true })
  const base = `${net.horizonUrl}/accounts/${me}/payments`
  // Only payments after this moment settle the request.
  let cursor = '0'
  try {
    const r = await fetch(`${base}?order=desc&limit=1`)
    if (r.ok) cursor = ((await r.json()) as { _embedded: { records: PaymentRecord[] } })._embedded.records[0]?.id ?? '0'
  } catch { /* offline: start from the beginning */ }
  const poll = async () => {
    if (stopped) return
    try {
      const r = await fetch(`${base}?order=asc&limit=20&cursor=${cursor}`)
      if (r.ok) {
        status.textContent = 'Waiting for payment…'
        const recs = ((await r.json()) as { _embedded: { records: PaymentRecord[] } })._embedded.records
        const hit = matchIncoming(recs, me, n)
        if (recs.length) cursor = recs[recs.length - 1].id
        if (hit && !stopped) {
          stopped = true
          await refresh()
          receipt({
            title: 'QR payment received', amount: hit.amount, direction: 'in', status: 'confirmed',
            counterpartyLabel: 'From', counterparty: hit.from, note: 'Paid by QR', txs: [['Payment', hit.hash]],
          }, net.explorer, () => void pay('qr'))
          return
        }
      } else if (r.status === 404) {
        status.textContent = 'Waiting for payment… (this account opens with the first one)'
      }
    } catch {
      status.textContent = 'Offline. The payment will still arrive.'
    }
    setTimeout(poll, 3000)
  }
  void poll()
}
