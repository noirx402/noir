import { NETWORKS, type NetworkId } from '../shared/networks'
import {
  FEE_XLM, MEMO_MAX_BYTES, fromStroops, MIN_CREATE_XLM, Noir, isAddress, memoOk, parsePaymentRequest, parseXlm, paymentUri, spendable, toAmount,
} from '../shared/noir'
import { busy, h, send, short } from '../shared/ui'
import { activityRow, loadActivity, openActivity } from './activity'
import { noir } from './cards'
import { claimBox } from './pay'
import { scanQr } from './qrscan'
import {
  back, btn, copyBtn, ctx, explorerLink, field, input, kv, nav, page, pill, qr, refresh, run, screen, spacer, xlm,
} from './kit'

const net = () => NETWORKS[ctx.s.network]

export const balanceOf = (address: string, network: NetworkId) => new Noir(network).account(address)

function jobBanner() {
  const j = ctx.s.job
  if (!j) return null
  if (!j.done) {
    // Still running in the service worker: check back until it settles.
    setTimeout(async () => { if (!document.querySelector('.banner.busy')) return; await refresh(); home() }, 2500)
    return h('div', { class: 'banner busy', role: 'status' }, h('span', { class: 'spinner sm', 'aria-hidden': 'true' }), h('span', { class: 'grow' }, `${j.label}…`))
  }
  const dismiss = btn('Dismiss', 'sm', async () => { await chrome.storage.session.remove('job'); await refresh(); home() })
  return h('div', { class: `banner ${j.done.ok ? 'ok' : 'bad'}`, role: 'status' },
    h('div', { class: 'grow' }, h('b', {}, j.done.ok ? j.label : `${j.label} failed`), h('div', { class: 'small' }, j.done.message)),
    j.done.hash ? explorerLink(net().explorer, `tx/${j.done.hash}`, 'Tx') : null, dismiss)
}

export async function home() {
  const s = ctx.s
  const address = s.address!
  const netSel = h('select', { 'aria-label': 'Network' },
    ...(['TESTNET', 'PUBLIC'] as NetworkId[]).map((n) => h('option', { value: n, selected: n === s.network }, n === 'TESTNET' ? 'Testnet' : 'Mainnet'))) as HTMLSelectElement
  netSel.addEventListener('change', async () => { await send({ type: 'setNetwork', network: netSel.value as NetworkId }); await refresh(); home() })
  const lock = btn('Lock', 'sm', async () => { await send({ type: 'lock' }); await refresh(); nav.tab('wallet') })

  const balance = h('div', { class: 'balance', 'aria-live': 'polite' }, '…')
  const avail = h('p', { class: 'small muted' })
  const onCards = h('p', { class: 'small muted' })
  const fundErr = h('p', { class: 'err', role: 'alert' })
  const fundBtn = btn('Fund with Friendbot', 'sm', () => busy(fundBtn, fundErr, async () => {
    const r = await fetch(`https://friendbot.stellar.org/?addr=${address}`)
    if (!r.ok) throw new Error('Friendbot didn’t fund it. Try again in a minute.')
    await home()
  }))
  const fundRow = h('div', { hidden: true }, h('p', { class: 'small muted' }, 'This account isn’t on Testnet yet.'), fundBtn, fundErr)
  const recent = h('ul', { class: 'list' }, h('li', {}, h('span', { class: 'muted small' }, 'Loading activity…')))
  const claims = h('div', {})

  screen({
    tab: 'wallet',
    right: [netSel, lock],
    body: [
      jobBanner(),
      h('div', { class: 'card' },
        h('p', { class: 'kicker' }, s.network === 'TESTNET' ? 'Stellar Testnet' : 'Stellar Mainnet'),
        balance, avail, onCards,
        h('div', { class: 'row', style: 'margin-top:12px;align-items:center' },
          h('span', { class: 'mono', title: address, style: 'flex:1;white-space:nowrap;word-break:normal' }, short(address)),
          copyBtn(address), explorerLink(net().explorer, `account/${address}`, 'Explorer')),
        fundRow),
      h('div', { class: 'row' }, btn('Send', 'gold', () => sendForm()), btn('Receive', '', () => receive()), btn('Tap', '', () => nav.tab('pay'))),
      claims,
      h('section', {},
        h('div', { class: 'section-head' }, h('h3', {}, 'Recent activity'), btn('See all', 'sm', () => nav.tab('activity'))),
        recent),
    ],
  })

  try {
    const a = await balanceOf(address, s.network)
    balance.replaceChildren(a.xlm.toLocaleString(undefined, { maximumFractionDigits: 2 }), h('small', {}, 'XLM'))
    avail.textContent = a.exists ? `${xlm(spendable(a.xlm, a.subentries), 2)} available after the network reserve` : ''
    if (!a.exists && s.network === 'TESTNET') fundRow.hidden = false
  } catch {
    balance.replaceChildren(h('span', { class: 'muted small' }, 'Balance unavailable offline'))
  }
  if (s.network === 'TESTNET') {
    void claimBox(claims, () => void home())
    // The app's "On your cards": what the cards' escrows hold on top of the wallet.
    void noir().cards(address).then((cs) => {
      const total = cs.reduce((t, c) => t + fromStroops(c.escrow), 0)
      if (cs.length) onCards.textContent = `${xlm(total, 2)} on ${cs.length} card${cs.length === 1 ? '' : 's'}`
    }, () => {})
  }
  try {
    const items = await loadActivity(address, s.network, 3)
    recent.replaceChildren(...(items.length
      ? items.map((i) => activityRow(i, () => openActivity(i, home)))
      : [h('li', {}, h('span', { class: 'muted small' }, 'No activity yet.'))]))
  } catch {
    recent.replaceChildren(h('li', {}, h('span', { class: 'muted small' }, 'Couldn’t load activity.')))
  }
}

// ── Send ────────────────────────────────────────────────────────────

export function sendForm(prefill: { destination?: string; amount?: string; memo?: string } = {}) {
  const to = input({ placeholder: 'G… address or web+stellar:pay link', 'aria-label': 'Recipient', value: prefill.destination ?? '' })
  const amount = input({ inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Amount in XLM', value: prefill.amount ?? '' })
  const memo = input({ placeholder: 'Optional', 'aria-label': 'Memo', maxlength: String(MEMO_MAX_BYTES), value: prefill.memo ?? '' })
  const caption = h('p', { class: 'small muted' }, 'Checking your balance…')
  const err = h('p', { class: 'err', role: 'alert' })
  // The service worker re-checks the balance, so an unreadable one doesn't block here.
  const maxP = balanceOf(ctx.s.address!, ctx.s.network).then((a) => {
    const m = spendable(a.xlm, a.subentries)
    caption.textContent = a.exists ? `${xlm(m, 2)} available` : 'Your wallet isn’t on the network yet.'
    return m
  }, () => { caption.textContent = 'Couldn’t check your balance.'; return Infinity })

  // Pasting a payment link fills in the whole form.
  to.addEventListener('input', () => {
    if (!to.value.trim().toLowerCase().startsWith('web+stellar:')) return
    const req = parsePaymentRequest(to.value)
    if (!req) { err.textContent = 'That payment link isn’t for XLM on Stellar.'; return }
    to.value = req.destination
    if (req.amount) amount.value = req.amount
    if (req.memo) memo.value = req.memo
  })
  const scan = btn('Scan QR', 'sm', () => scanQr('send', (r) => sendForm(r), () => sendForm({ destination: to.value, amount: amount.value, memo: memo.value })))
  const maxBtn = btn('Max', 'sm', async () => { const m = await maxP; if (m > 0 && m < Infinity) amount.value = toAmount(Math.floor(m * 1e7) / 1e7) })
  const review = btn('Review', 'gold', async () => busy(review, err, async () => {
    const destination = to.value.trim()
    if (!isAddress(destination)) throw new Error('Enter a Stellar address that starts with G.')
    if (destination === ctx.s.address) throw new Error('That is this wallet’s own address.')
    const n = parseXlm(amount.value)
    const max = await maxP
    if (n > max) throw new Error(`Only ${xlm(max, 2)} is available after the network reserve.`)
    if (memo.value && !memoOk(memo.value)) throw new Error(`A memo is at most ${MEMO_MAX_BYTES} bytes.`)
    const dest = await balanceOf(destination, ctx.s.network)
    if (!dest.exists && n < MIN_CREATE_XLM) throw new Error(`That account isn’t on the network yet. Send at least ${MIN_CREATE_XLM} XLM to open it.`)
    sendReview({ destination, amount: n, memo: memo.value.trim(), opensAccount: !dest.exists }, () => sendForm({ destination, amount: amount.value, memo: memo.value }))
  }))

  page({
    left: back(home),
    body: [
      h('h1', {}, 'Send XLM'),
      field('To', h('div', { class: 'row', style: 'align-items:center' }, to, scan)),
      field('Amount', h('div', { class: 'row', style: 'align-items:center' }, amount, maxBtn), caption),
      field('Memo', memo, 'Exchanges often need one. Up to 28 bytes of text.'),
      err,
    ],
    foot: [btn('Cancel', '', home), review],
  })
  ;(prefill.destination ? amount : to).focus()
}

function sendReview(p: { destination: string; amount: number; memo: string; opensAccount: boolean }, edit: () => void) {
  page({
    left: back(edit),
    body: [
      h('p', { class: 'kicker' }, 'Review'),
      h('div', { class: 'balance' }, p.amount.toLocaleString(undefined, { maximumFractionDigits: 7 }), h('small', {}, 'XLM')),
      kv([
        ['To', p.destination, true],
        p.memo ? ['Memo', p.memo] : null,
        ['Network', net().id === 'PUBLIC' ? 'Stellar Mainnet' : 'Stellar Testnet'],
        ['Fee', `about ${xlm(FEE_XLM)}`],
      ]),
      p.opensAccount ? h('p', { class: 'warning' }, 'This account doesn’t exist yet. Sending opens it on Stellar.') : null,
      net().id === 'PUBLIC' ? h('p', { class: 'warning' }, 'This is Mainnet: real XLM. Payments can’t be reversed.') : null,
    ],
    foot: [btn('Edit', '', edit), btn('Send now', 'gold', () => run({
      label: `Sending ${xlm(p.amount)}`,
      msg: { type: 'send', destination: p.destination, amount: p.amount, memo: p.memo || undefined },
      explorer: net().explorer,
      done: async () => { await refresh(); home() },
      receipt: (r) => ({
        title: 'Sent XLM', amount: p.amount, direction: 'out', status: 'confirmed', counterpartyLabel: 'To', counterparty: p.destination,
        note: p.memo ? `Memo: ${p.memo}` : undefined, txs: r.hash ? [['Payment', r.hash]] : [],
      }),
    }))],
  })
}

// ── Receive ─────────────────────────────────────────────────────────

export function receive() {
  const address = ctx.s.address!
  const amount = input({ inputmode: 'decimal', placeholder: 'Any amount', 'aria-label': 'Requested amount in XLM' })
  const memo = input({ placeholder: 'Optional', 'aria-label': 'Memo', maxlength: String(MEMO_MAX_BYTES) })
  const code = h('div', { class: 'qr' })
  const link = h('p', { class: 'mono small muted' })
  const copyLink = btn('Copy payment link', 'sm', async () => { await navigator.clipboard.writeText(link.textContent ?? ''); copyLink.textContent = 'Copied' })
  const draw = () => {
    const a = amount.value.trim()
    const uri = paymentUri({ destination: address, amount: /^\d+(\.\d{1,7})?$/.test(a) ? a : undefined, memo: memoOk(memo.value) ? memo.value : undefined })
    code.replaceChildren(qr(uri))
    link.textContent = uri
  }
  amount.addEventListener('input', draw)
  memo.addEventListener('input', draw)
  draw()
  page({
    left: back(home),
    body: [
      h('h1', {}, 'Receive XLM'),
      h('p', { class: 'muted' }, `Scan with the Noir app or any Stellar wallet. Only send ${ctx.s.network === 'PUBLIC' ? 'Mainnet' : 'Testnet'} XLM to this address.`),
      code,
      h('p', { class: 'mono', title: address }, address),
      h('div', { class: 'row' }, copyBtn(address, 'Copy address'), copyLink),
      field('Request an amount', amount), field('Memo', memo),
      link, spacer(),
      pill(ctx.s.network === 'PUBLIC' ? 'Mainnet' : 'Testnet', ctx.s.network === 'PUBLIC' ? 'warn' : ''),
    ],
  })
}
