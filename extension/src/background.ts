/**
 * Noir service worker. Owns the vault, the unlocked key, site
 * permissions and the approval queue. Pages never see a key: they get
 * addresses and signatures, and only after the user approves in a Noir
 * window.
 */
import { Keypair } from '@stellar/stellar-sdk'
import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { AGENT_SCAN, deriveAgent, deriveFromSeed, seedOf } from './shared/hd'
import { open, seal, type SealedVault } from './shared/vault'
import { NETWORKS, type NetworkId } from './shared/networks'
import { signAuthEntry, signMessage, signTransaction, SigningError } from './shared/signing'
import { Noir } from './shared/noir'
import {
  AUTO_LOCK_CHOICES, ERR, type ApprovalKind, type DappRequest, type DappResponse, type Job, type PendingApproval, type UiMessage, type WalletError,
} from './shared/protocol'

const AUTO_LOCK_MIN = 15

interface Stored {
  vault?: SealedVault
  address?: string
  network?: NetworkId
  origins?: Record<string, { connectedAt: number }>
  /** Names the user gave cards here; the chain only knows their hash. */
  cardLabels?: Record<string, string>
  /** Agent indexes of unlinked cards, never handed out again. */
  retiredAgents?: number[]
  autoLockMin?: number
  /** Incoming-payment notifications (needs the optional notifications permission). */
  notify?: boolean
  /** Newest Horizon payment id already notified about, per address+network. */
  notifyCursor?: Record<string, string>
}

const KEYS: (keyof Stored)[] = ['vault', 'address', 'network', 'origins', 'cardLabels', 'retiredAgents', 'autoLockMin', 'notify', 'notifyCursor']
const local = {
  get: async (): Promise<Stored> => (await chrome.storage.local.get(KEYS)) as Stored,
  set: (v: Partial<Stored>) => chrome.storage.local.set(v),
}

// The unlocked secret lives only in session storage: memory-backed, cleared
// when the browser closes, and not readable from content scripts.
chrome.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })

// The seed is kept too: card agents are derived from it (m/44'/148'/0'/n').
async function unlocked(): Promise<{ kp: Keypair; seed: Uint8Array } | null> {
  const { secret, seed } = (await chrome.storage.session.get(['secret', 'seed'])) as { secret?: string; seed?: string }
  if (!secret || !seed) return null
  await chrome.storage.session.set({ lastActive: Date.now() })
  return { kp: Keypair.fromSecret(secret), seed: Uint8Array.from(Buffer.from(seed, 'hex')) }
}

async function secretKey(): Promise<Keypair | null> {
  return (await unlocked())?.kp ?? null
}

async function openSession(mnemonic: string): Promise<Keypair> {
  const seed = await seedOf(mnemonic)
  const kp = await deriveFromSeed(seed, [44, 148, 0])
  await chrome.storage.session.set({ secret: kp.secret(), seed: Buffer.from(seed).toString('hex'), lastActive: Date.now() })
  return kp
}

async function unlock(password: string): Promise<boolean> {
  const { vault } = await local.get()
  if (!vault) return false
  const mnemonic = await open(vault, password)
  if (!mnemonic) return false
  await openSession(mnemonic)
  return true
}

const lock = () => chrome.storage.session.remove(['secret', 'seed', 'lastActive'])

chrome.alarms.create('autolock', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'autolock') return
  const { lastActive } = (await chrome.storage.session.get('lastActive')) as { lastActive?: number }
  const minutes = (await local.get()).autoLockMin ?? AUTO_LOCK_MIN
  if (lastActive && Date.now() - lastActive > minutes * 60_000) await lock()
})

async function networkInfo() {
  return NETWORKS[(await local.get()).network ?? 'TESTNET']
}

// ── Notifications ───────────────────────────────────────────────────

const canNotify = () => chrome.permissions.contains({ permissions: ['notifications'] }).catch(() => false)

/** Popup or a Noir window is open: the user sees the result there already. */
async function someoneWatching(): Promise<boolean> {
  try {
    const open = await chrome.runtime.getContexts?.({ contextTypes: [chrome.runtime.ContextType.POPUP, chrome.runtime.ContextType.TAB] })
    return !!open?.length
  } catch { return false }
}

async function notify(title: string, message: string) {
  if (!(await local.get()).notify || !(await canNotify())) return
  chrome.notifications.create({ type: 'basic', iconUrl: chrome.runtime.getURL('icons/128.png'), title, message, priority: 1 })
}

async function notifyIfAway(title: string, message: string) {
  if (!(await someoneWatching())) await notify(title, message)
}

/**
 * Notify about payments that arrived since the last look, like the app's
 * paymentNotifier. `prime` only records where we are (no backlog alerts).
 */
async function checkIncoming(prime = false) {
  const s = await local.get()
  if (!s.notify || !s.address) return
  const net = NETWORKS[s.network ?? 'TESTNET']
  const key = `${net.id}:${s.address}`
  const res = await fetch(`${net.horizonUrl}/accounts/${s.address}/payments?order=desc&limit=10`).catch(() => null)
  if (!res?.ok) return
  const records = ((await res.json()) as { _embedded: { records: { id: string; type: string; to?: string; from?: string; account?: string; funder?: string; amount?: string; starting_balance?: string; asset_type?: string; asset_code?: string }[] } })._embedded.records
  const cursor = s.notifyCursor?.[key]
  if (records[0]) await local.set({ notifyCursor: { ...s.notifyCursor, [key]: records[0].id } })
  if (prime || !cursor) return
  for (const r of records) {
    if (BigInt(r.id) <= BigInt(cursor)) break
    const incoming = r.type === 'create_account' ? r.account === s.address : r.to === s.address && r.from !== s.address
    if (!incoming) continue
    const amount = r.amount ?? r.starting_balance ?? '?'
    const asset = r.asset_type === 'native' || r.type === 'create_account' ? 'XLM' : r.asset_code ?? ''
    const from = r.from ?? r.funder ?? ''
    await notify(`Received ${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 7 })} ${asset}`, `From ${from.slice(0, 6)}…${from.slice(-6)} on ${net.id === 'PUBLIC' ? 'Mainnet' : 'Testnet'}`)
  }
}

chrome.alarms.create('incoming', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'incoming') void checkIncoming() })

// ── Approvals ───────────────────────────────────────────────────────

const pending = new Map<string, { approval: PendingApproval; resolve: (ok: boolean) => void; windowId?: number }>()

async function askUser(kind: ApprovalKind, origin: string, payload?: string): Promise<boolean> {
  const approval: PendingApproval = {
    id: crypto.randomUUID(), kind, origin, payload,
    networkPassphrase: (await networkInfo()).passphrase, createdAt: Date.now(),
  }
  return new Promise<boolean>((resolve) => {
    pending.set(approval.id, { approval, resolve })
    chrome.windows.create(
      { url: chrome.runtime.getURL(`approve.html?id=${approval.id}`), type: 'popup', width: 380, height: 640, focused: true },
      (w) => { const p = pending.get(approval.id); if (p && w?.id !== undefined) p.windowId = w.id },
    )
  })
}

function settle(id: string, ok: boolean) {
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  p.resolve(ok)
}

// Closing the approval window is a rejection.
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, p] of pending) if (p.windowId === windowId) settle(id, false)
})

// ── dApp requests ───────────────────────────────────────────────────

class Fail extends Error { constructor(readonly error: WalletError) { super(error.message) } }

async function connected(origin: string): Promise<boolean> {
  return !!(await local.get()).origins?.[origin]
}

async function requireConnected(origin: string) {
  if (!(await connected(origin))) throw new Fail(ERR.internal('This site is not connected to Noir. Call requestAccess() first.'))
}

async function requireNetworkAndSigner(opts: { networkPassphrase?: string; address?: string } | undefined) {
  const net = await networkInfo()
  const { address } = await local.get()
  if (opts?.networkPassphrase && opts.networkPassphrase !== net.passphrase) {
    throw new Fail(ERR.unsupported(`Noir is on ${net.name}. Switch networks in the wallet, or request ${net.name}.`))
  }
  if (opts?.address && opts.address !== address) {
    throw new Fail(ERR.invalid(`Noir does not hold ${opts.address}.`))
  }
  return net
}

/** After approval: the key, which the approval window made sure is unlocked. */
async function keyAfterApproval(): Promise<Keypair> {
  const kp = await secretKey()
  if (!kp) throw new Fail(ERR.internal('Noir is locked.'))
  return kp
}

async function handleDapp(origin: string, req: DappRequest): Promise<unknown> {
  const s = await local.get()
  const net = await networkInfo()
  switch (req.method) {
    case 'isConnected':
      return { isConnected: true }
    case 'isAllowed':
      return { isAllowed: await connected(origin) }
    case 'getNetwork':
      return { network: net.name, networkPassphrase: net.passphrase }
    case 'getAddress':
    case 'requestAccess': {
      if (!s.vault || !s.address) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html#onboarding') })
        throw new Fail(ERR.internal('Set up Noir first, then try again.'))
      }
      if (!(await connected(origin))) {
        if (!(await askUser('connect', origin))) throw new Fail(ERR.rejected())
        await local.set({ origins: { ...(await local.get()).origins, [origin]: { connectedAt: Date.now() } } })
      }
      return { address: s.address }
    }
    case 'signTransaction': {
      await requireConnected(origin)
      const xdr = req.params?.xdr
      if (typeof xdr !== 'string') throw new Fail(ERR.invalid('xdr is required'))
      const n = await requireNetworkAndSigner(req.params?.opts)
      if (!(await askUser('signTransaction', origin, xdr))) throw new Fail(ERR.rejected())
      return { signedTxXdr: signTransaction(await keyAfterApproval(), xdr, n.passphrase), signerAddress: s.address }
    }
    case 'signAuthEntry': {
      await requireConnected(origin)
      const entry = req.params?.authEntry
      if (typeof entry !== 'string') throw new Fail(ERR.invalid('authEntry is required'))
      const n = await requireNetworkAndSigner(req.params?.opts)
      if (!(await askUser('signAuthEntry', origin, entry))) throw new Fail(ERR.rejected())
      return { signedAuthEntry: signAuthEntry(await keyAfterApproval(), entry, n.passphrase), signerAddress: s.address }
    }
    case 'signMessage': {
      await requireConnected(origin)
      const message = req.params?.message
      if (typeof message !== 'string') throw new Fail(ERR.invalid('message is required'))
      await requireNetworkAndSigner(req.params?.opts)
      if (!(await askUser('signMessage', origin, message))) throw new Fail(ERR.rejected())
      return { signedMessage: signMessage(await keyAfterApproval(), message), signerAddress: s.address }
    }
    default:
      throw new Fail(ERR.unsupported(`Unknown method ${(req as { method: string }).method}`))
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'noir-dapp') return
  // The origin comes from Chrome, never from the page.
  const origin = port.sender?.origin ?? (port.sender?.url ? new URL(port.sender.url).origin : '')
  port.onMessage.addListener(async (msg: { id: string; request?: DappRequest; ping?: true }) => {
    if (msg.ping || !msg.request) return
    let res: DappResponse
    try {
      if (!origin) throw new Fail(ERR.internal('Unknown origin'))
      res = { ok: true, result: await handleDapp(origin, msg.request) }
    } catch (e) {
      res = {
        ok: false,
        error: e instanceof Fail ? e.error : e instanceof SigningError ? ERR.invalid(e.message) : ERR.internal(String((e as Error)?.message ?? e)),
      }
    }
    try { port.postMessage({ id: msg.id, response: res }) } catch { /* tab went away */ }
  })
})

// ── Wallet writes from the popup ────────────────────────────────────

async function keys() {
  const k = await unlocked()
  if (!k) throw new Error('Noir is locked. Unlock it and try again.')
  return k
}

async function noir() {
  return new Noir((await local.get()).network ?? 'TESTNET')
}

/**
 * Runs a write and records it in session storage, so a popup that closed
 * while Stellar confirmed it can show how it went when it reopens.
 */
async function job<T extends { hash?: string; message: string }>(label: string, fn: () => Promise<T>): Promise<T> {
  const { job: running } = (await chrome.storage.session.get('job')) as { job?: Job }
  if (running && !running.done && Date.now() - running.startedAt < 5 * 60_000) throw new Error(`Still working on “${running.label}”.`)
  await chrome.storage.session.set({ job: { label, startedAt: Date.now() } satisfies Job })
  try {
    const r = await fn()
    await chrome.storage.session.set({ job: { label, startedAt: Date.now(), done: { ok: true, message: r.message, hash: r.hash } } satisfies Job })
    void notifyIfAway(label, r.message)
    return r
  } catch (e) {
    const message = String((e as Error)?.message ?? e)
    await chrome.storage.session.set({ job: { label, startedAt: Date.now(), done: { ok: false, message } } satisfies Job })
    void notifyIfAway(`${label} failed`, message)
    throw e
  }
}

const xlm = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 7 })} XLM`

async function agentKeyFor(seed: Uint8Array, agent: string): Promise<{ index: number; kp: Keypair } | null> {
  for (let i = 1; i <= AGENT_SCAN; i++) {
    const kp = await deriveAgent(seed, i)
    if (kp.publicKey() === agent) return { index: i, kp }
  }
  return null
}

/** This wallet's key for a card's agent, or a sentence saying why it can't sign here. */
async function cardAgent(n: Noir, kp: Keypair, seed: Uint8Array, deviceHash: string) {
  const c = await n.card(deviceHash, kp.publicKey())
  if (!c.agent) throw new Error('This card has no agent. Finish linking it first.')
  const key = await agentKeyFor(seed, c.agent)
  if (!key) throw new Error('This card’s agent key isn’t from this recovery phrase, so it can’t pay from here.')
  return key.kp
}

async function handleWrite(msg: UiMessage): Promise<unknown> {
  switch (msg.type) {
    case 'send': {
      const { kp } = await keys()
      const n = await noir()
      return job(`Send ${xlm(msg.amount)}`, async () => {
        const hash = await n.pay(kp, msg.destination.trim(), msg.amount, msg.memo?.trim() || undefined)
        return { hash, message: `Sent ${xlm(msg.amount)}.` }
      })
    }
    case 'linkCard': {
      const { kp, seed } = await keys()
      const n = await noir()
      const s = await local.get()
      return job(`Link ${msg.label}`, async () => {
        const r = await n.link({ wallet: kp, seed, deviceHash: msg.deviceHash, maxXlm: msg.maxXlm, expiryDays: msg.expiryDays, retired: s.retiredAgents })
        await local.set({ cardLabels: { ...(await local.get()).cardLabels, [msg.deviceHash]: msg.label } })
        return { ...r, message: r.alreadyLinked ? `${msg.label} was already linked to this wallet.` : `${msg.label} is linked.` }
      })
    }
    case 'fundEscrow': {
      const { kp } = await keys()
      const n = await noir()
      return job(`Add ${xlm(msg.amount)} to escrow`, async () => ({ hash: await n.fundEscrow(kp, msg.deviceHash, msg.amount), message: `Added ${xlm(msg.amount)} to the card’s escrow.` }))
    }
    case 'withdrawEscrow': {
      const { kp } = await keys()
      const n = await noir()
      return job(`Withdraw ${xlm(msg.amount)}`, async () => ({ hash: await n.withdrawEscrow(kp, msg.deviceHash, msg.amount), message: `Moved ${xlm(msg.amount)} back to your wallet.` }))
    }
    case 'topUpAgent': {
      const { kp } = await keys()
      const n = await noir()
      return job(`Top up agent with ${xlm(msg.amount)}`, async () => {
        const { agent } = await n.card(msg.deviceHash, kp.publicKey())
        if (!agent) throw new Error('This card has no agent.')
        return { hash: await n.topUpAgent(kp, agent, msg.amount), message: `Sent ${xlm(msg.amount)} to the card’s agent.` }
      })
    }
    case 'setPolicy': {
      const { kp } = await keys()
      const n = await noir()
      return job('Update agent policy', async () => ({ hash: await n.setPolicy(kp, msg.deviceHash, msg.maxXlm, msg.expiryDays), message: 'The agent’s policy is updated.' }))
    }
    case 'unlinkCard': {
      const { kp, seed } = await keys()
      const n = await noir()
      return job('Unlink card', async () => {
        const { agent } = await n.card(msg.deviceHash, kp.publicKey())
        const agentKey = agent ? await agentKeyFor(seed, agent) : null
        const r = await n.unlink(kp, msg.deviceHash, agentKey?.kp ?? null)
        const s = await local.get()
        const cardLabels = { ...s.cardLabels }
        delete cardLabels[msg.deviceHash]
        const retiredAgents = agentKey ? [...new Set([...(s.retiredAgents ?? []), agentKey.index])] : s.retiredAgents
        await local.set({ cardLabels, retiredAgents })
        const back = r.escrowReturned + r.agentSwept
        return { ...r, message: back > 0 ? `Card unlinked. ${xlm(back)} came back to your wallet.` : 'Card unlinked.' }
      })
    }
    case 'charge': {
      const { kp, seed } = await keys()
      const n = await noir()
      const agentKp = await cardAgent(n, kp, seed, msg.deviceHash)
      return job(`Charge ${xlm(msg.amount)}`, async () => {
        const r = await n.charge(kp, agentKp, msg.deviceHash, msg.amount)
        return { ...r, hash: r.claimHash, message: `${xlm(msg.amount)} came out of the card’s escrow into your wallet.` }
      })
    }
    case 'payWithCard': {
      const { kp, seed } = await keys()
      const n = await noir()
      const own = await n.ownership(msg.deviceHash, kp.publicKey())
      if (own.status !== 'mine') throw new Error('Only your own cards can pay from this wallet.')
      if (!own.active) throw new Error('This card was revoked and can’t pay.')
      if (msg.merchant.trim() === kp.publicKey()) throw new Error('That is this wallet’s own address. Use Charge to pay yourself from a card.')
      const agentKp = await cardAgent(n, kp, seed, msg.deviceHash)
      return job(`Pay ${xlm(msg.amount)} by card`, async () => ({
        hash: await n.authorize(agentKp, msg.deviceHash, msg.merchant.trim(), msg.amount),
        message: `${xlm(msg.amount)} is reserved for the merchant in Noir’s escrow. It reaches them when they claim it.`,
      }))
    }
    case 'claim': {
      const { kp } = await keys()
      const n = await noir()
      return job('Claim card payments', async () => {
        const r = await n.claim(kp)
        return { ...r, message: `Claimed ${xlm(r.xlm)} from card payments.` }
      })
    }
    default:
      throw new Error('Unknown request.')
  }
}

// ── Popup and approval window ───────────────────────────────────────

async function handleUi(msg: UiMessage): Promise<unknown> {
  switch (msg.type) {
    case 'state': {
      const s = await local.get()
      const net = await networkInfo()
      const { job: last } = (await chrome.storage.session.get('job')) as { job?: Job }
      return {
        hasWallet: !!s.vault, unlocked: !!(await secretKey()), address: s.address ?? null,
        network: net.id, origins: Object.keys(s.origins ?? {}),
        cardLabels: s.cardLabels ?? {}, autoLockMin: s.autoLockMin ?? AUTO_LOCK_MIN, job: last ?? null,
        notify: !!s.notify && (await canNotify()),
      }
    }
    case 'create': {
      const mnemonic = msg.mnemonic.trim().toLowerCase().split(/\s+/).join(' ')
      if (!validateMnemonic(mnemonic, wordlist)) throw new Error('That recovery phrase is not valid.')
      if (msg.password.length < 8) throw new Error('Use at least 8 characters.')
      const vault = await seal(mnemonic, msg.password)
      const kp = await openSession(mnemonic)
      await local.set({ vault, address: kp.publicKey(), origins: {}, cardLabels: {}, retiredAgents: [] })
      return { address: kp.publicKey() }
    }
    case 'unlock':
      if (!(await unlock(msg.password))) throw new Error('Wrong password.')
      return { ok: true }
    case 'lock':
      await lock()
      return { ok: true }
    case 'setNetwork':
      await local.set({ network: msg.network })
      return { ok: true }
    case 'revokeOrigin': {
      const origins = { ...(await local.get()).origins }
      delete origins[msg.origin]
      await local.set({ origins })
      return { ok: true }
    }
    case 'revealMnemonic': {
      const { vault } = await local.get()
      const mnemonic = vault && (await open(vault, msg.password))
      if (!mnemonic) throw new Error('Wrong password.')
      return { mnemonic }
    }
    case 'reset':
      await lock()
      await chrome.storage.session.remove('job')
      await chrome.storage.local.clear()
      return { ok: true }
    case 'changePassword': {
      const { vault } = await local.get()
      const mnemonic = vault && (await open(vault, msg.password))
      if (!mnemonic) throw new Error('Wrong password.')
      if (msg.next.length < 8) throw new Error('Use at least 8 characters.')
      await local.set({ vault: await seal(mnemonic, msg.next) })
      return { ok: true }
    }
    case 'exportSecret': {
      const { vault } = await local.get()
      const mnemonic = vault && (await open(vault, msg.password))
      if (!mnemonic) throw new Error('Wrong password.')
      return { secret: (await deriveFromSeed(await seedOf(mnemonic), [44, 148, 0])).secret() }
    }
    case 'setNotify':
      // The popup asked Chrome for the permission first; this only records the choice.
      if (msg.on && !(await canNotify())) throw new Error('Chrome didn’t allow notifications.')
      await local.set({ notify: msg.on })
      if (msg.on) await checkIncoming(true)
      return { ok: true }
    case 'setAutoLock':
      if (!AUTO_LOCK_CHOICES.includes(msg.minutes)) throw new Error('Pick one of the listed times.')
      await local.set({ autoLockMin: msg.minutes })
      return { ok: true }
    case 'setCardLabel': {
      const label = msg.label.trim().slice(0, 32)
      if (!label) throw new Error('Give the card a name.')
      await local.set({ cardLabels: { ...(await local.get()).cardLabels, [msg.deviceHash]: label } })
      return { ok: true }
    }
    case 'agentKeys': {
      // Public keys only: the popup uses them to tell which agents this wallet holds.
      const { seed } = await keys()
      const out: Record<string, number> = {}
      for (let i = 1; i <= AGENT_SCAN; i++) out[(await deriveAgent(seed, i)).publicKey()] = i
      return out
    }
    case 'pending': {
      const p = pending.get(msg.id)
      if (!p) throw new Error('This request is no longer waiting.')
      const s = await local.get()
      return { ...p.approval, address: s.address }
    }
    case 'resolve':
      if (msg.approve && !(await secretKey())) throw new Error('Unlock first.')
      settle(msg.id, msg.approve)
      return { ok: true }
    default:
      return handleWrite(msg)
  }
}

chrome.runtime.onMessage.addListener((msg: UiMessage, sender, reply) => {
  // Only the extension's own pages may drive the wallet.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false
  handleUi(msg).then((result) => reply({ ok: true, result }), (e) => reply({ ok: false, error: String((e as Error)?.message ?? e) }))
  return true
})
