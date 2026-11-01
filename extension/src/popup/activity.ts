import { NETWORKS, type NetworkId } from '../shared/networks'
import { toActivity, type ActivityItem, type HorizonOp } from '../shared/noir'
import { h, short } from '../shared/ui'
import { back, btn, chips, copyBtn, ctx, explorerLink, kv, page, pill, screen, when, xlm } from './kit'
import { sendForm } from './wallet'

export async function loadActivity(address: string, network: NetworkId, limit = 50): Promise<ActivityItem[]> {
  const res = await fetch(`${NETWORKS[network].horizonUrl}/accounts/${address}/payments?order=desc&limit=${limit}&join=transactions`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Horizon answered ${res.status}.`)
  const body = (await res.json()) as { _embedded: { records: HorizonOp[] } }
  return body._embedded.records.map((r) => toActivity(r, address))
}

const signed = (i: ActivityItem) =>
  `${i.direction === 'in' ? '+' : i.direction === 'out' ? '−' : ''}${(i.amount ?? 0).toLocaleString(undefined, { maximumFractionDigits: 7 })}`

export function activityRow(i: ActivityItem, open: () => void) {
  return h('li', { class: 'tap', tabindex: '0', role: 'button', onclick: open, onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') open() } },
    h('div', { class: `dot ${i.direction}`, 'aria-hidden': 'true' }),
    h('div', { class: 'grow' },
      h('div', {}, i.title, ' ', i.ok ? null : pill('Failed', 'bad')),
      h('div', { class: 'small muted' }, `${i.counterparty ? `${short(i.counterparty)} · ` : ''}${when(i.at)}`)),
    i.amount != null ? h('div', { class: `amt ${i.direction}` }, signed(i), h('small', {}, ` ${i.asset}`)) : null)
}

type Filter = 'all' | 'out' | 'in'

export async function activity(filter: Filter = 'all') {
  const list = h('ul', { class: 'list' }, h('li', {}, h('span', { class: 'muted small' }, 'Loading…')))
  const f = chips<Filter>([{ label: 'All', value: 'all' }, { label: 'Sent', value: 'out' }, { label: 'Received', value: 'in' }], filter, (v) => void activity(v))
  screen({
    tab: 'activity',
    body: [
      h('h1', {}, 'Activity'),
      h('p', { class: 'small muted' }, `Payments and contract calls on ${ctx.s.network === 'PUBLIC' ? 'Mainnet' : 'Testnet'}.`),
      f.el, list,
    ],
  })
  try {
    const items = (await loadActivity(ctx.s.address!, ctx.s.network)).filter((i) => filter === 'all' || i.direction === filter)
    list.replaceChildren(...(items.length
      ? items.map((i) => activityRow(i, () => openActivity(i, () => activity(filter))))
      : [h('li', {}, h('span', { class: 'muted small' }, filter === 'all' ? 'No activity yet.' : 'Nothing here yet.'))]))
  } catch {
    list.replaceChildren(h('li', {}, h('span', { class: 'muted small' }, 'Couldn’t reach Horizon to load activity.')))
  }
}

export function openActivity(i: ActivityItem, onBack: () => void) {
  const explorer = NETWORKS[ctx.s.network].explorer
  page({
    left: back(onBack),
    body: [
      h('p', { class: 'kicker' }, i.title),
      i.amount != null ? h('div', { class: 'balance' }, signed(i), h('small', {}, i.asset)) : null,
      kv([
        ['Status', i.ok ? pill('Confirmed', 'ok') : pill('Failed', 'bad')],
        ['When', when(i.at)],
        i.counterparty ? [i.direction === 'in' ? 'From' : 'To', i.counterparty, true] : null,
        i.memo ? ['Memo', i.memo] : null,
        i.feeXlm != null ? ['Fee', xlm(i.feeXlm)] : null,
        ['Transaction', i.hash, true],
      ]),
      h('div', { class: 'row' }, copyBtn(i.hash, 'Copy hash'), explorerLink(explorer, `tx/${i.hash}`)),
      i.counterparty && i.counterparty.startsWith('G') ? btn('Send to this address', 'block', () => sendForm({ destination: i.counterparty! })) : null,
    ],
  })
}
