/**
 * Everything the Noir app does with a card, for the extension: link a tag to
 * the wallet with its own agent key and policy, fund and withdraw its escrow,
 * top up its agent, change the policy, and unlink it without stranding funds.
 * Also plain XLM payments. Mirrors frontend/src/domain/x402.ts so a card
 * linked here and one linked on the phone are the same thing on-chain.
 *
 * Runs in the service worker (keys never reach the popup) and in Node tests.
 */
import {
  Account, Address, Asset, BASE_FEE, Contract, Horizon, Keypair, Memo, Operation, StrKey, TransactionBuilder,
  rpc, scValToNative, xdr,
} from '@stellar/stellar-sdk'
import {
  NoirAgentClient, deviceHashScVal, parseContractError, toCall, toHex,
  type NoirContracts, type NoirOperation,
} from '@noirx402/agent-sdk'
import { AGENT_SCAN, deriveAgent } from './hd'
import { NETWORKS, type NetworkId } from './networks'

// ── Account rules (frontend/src/lib/stellarAccount.ts) ──────────────

export const BASE_RESERVE_XLM = 0.5
export const FEE_XLM = 0.00001
/** createAccount must send at least the new account's minimum balance. */
export const MIN_CREATE_XLM = 1
export const MEMO_MAX_BYTES = 28
/** The app's default policy at link time: 100,000 XLM per tap, never expires. */
export const DEFAULT_CAP_XLM = 100_000
/** What to suggest putting on a card's agent: it pays each tap's Soroban fee (~2.3 XLM for the first). */
export const AGENT_TOPUP_XLM = 5

export const minimumBalance = (subentries = 0) => (2 + Math.max(0, subentries)) * BASE_RESERVE_XLM
export const spendable = (xlm: number, subentries = 0, fee = FEE_XLM) => Math.max(0, xlm - minimumBalance(subentries) - fee)
export const isAddress = (a: string) => StrKey.isValidEd25519PublicKey(a.trim())
export const memoOk = (m: string) => new TextEncoder().encode(m).length <= MEMO_MAX_BYTES

/** 12.5 → '12.5'; never more than the 7 decimals Stellar stores. */
export function toAmount(xlm: number): string {
  return xlm.toFixed(7).replace(/0+$/, '').replace(/\.$/, '')
}
export const toStroops = (xlm: number) => BigInt(Math.round(xlm * 1e7))
export const fromStroops = (s: bigint) => Number(s) / 1e7

/** Parse a user-typed XLM amount: positive, at most 7 decimals. */
export function parseXlm(raw: string): number {
  const s = raw.trim()
  if (!/^\d+(\.\d{1,7})?$/.test(s) || Number(s) <= 0) throw new Error('Enter an amount greater than zero, up to 7 decimals.')
  return Number(s)
}

// ── Cards ───────────────────────────────────────────────────────────

/**
 * A tag UID the way the app hashes it: uppercase hex, no separators
 * (react-native-nfc-manager's bytesToHex). Accepts what NFC tools show,
 * e.g. "04:a2:b3:c4:d5:e6:80", which is also Web NFC's serialNumber.
 */
export function normalizeUid(raw: string): string {
  const hex = raw.replace(/[\s:-]/g, '').toUpperCase()
  if (!/^[0-9A-F]+$/.test(hex) || hex.length % 2 || hex.length < 8 || hex.length > 20) {
    throw new Error('A card UID is 4 to 10 bytes of hex, like 04:A2:B3:C4:D5:E6:80.')
  }
  return hex
}

/**
 * How a USB card reader in keyboard mode types a UID. Most type hex; some
 * type it as one decimal number, and some of those reverse the bytes first.
 */
export type ReaderFormat = 'hex' | 'dec' | 'dec-rev'

/** The UID a reader typed, as normalizeUid would give it. */
export function uidFromReader(raw: string, format: ReaderFormat = 'hex'): string {
  if (format === 'hex') return normalizeUid(raw)
  const s = raw.trim()
  if (!/^\d{1,25}$/.test(s)) throw new Error('This reader is set to decimal, but it typed something else. Change the reader format in Settings.')
  let hex = BigInt(s).toString(16).toUpperCase()
  // 4-byte (classic) or 7-byte (NTAG213) UIDs; anything longer keeps whole bytes.
  const bytes = hex.length <= 8 ? 4 : hex.length <= 14 ? 7 : Math.ceil(hex.length / 2)
  hex = hex.padStart(bytes * 2, '0')
  if (format === 'dec-rev') hex = hex.match(/../g)!.reverse().join('')
  return normalizeUid(hex)
}

/** SHA-256 of the UID — the device hash the contracts know the card by. */
export async function deviceHashOf(uid: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeUid(uid))))
}

export type Ownership =
  | { status: 'free' }
  | { status: 'mine' | 'other'; owner: string; agent: string; active: boolean; createdAt: Date | null }

export interface Policy { agent: string; maxAmount: bigint; expiresAt: Date | null }

/** Contract-ready policy from UI choices; mirrors register_agent's validation. */
export function buildPolicy(maxXlm: number, expiryDays: number, now = Date.now()): { maxAmount: bigint; expiresAt: Date | null } {
  if (!Number.isFinite(maxXlm) || maxXlm < 0) throw new Error('The per-tap limit must be zero or more.')
  if (!Number.isFinite(expiryDays) || expiryDays < 0) throw new Error('Expiry must be zero or more days.')
  return { maxAmount: toStroops(maxXlm), expiresAt: expiryDays === 0 ? null : new Date(now + Math.round(expiryDays * 86_400) * 1000) }
}

export interface CardSummary {
  deviceHash: string
  agent: string
  policy: Policy | null
  escrow: bigint
  active: boolean
  createdAt: Date | null
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

export class Noir {
  readonly client: NoirAgentClient
  readonly horizon: Horizon.Server
  readonly network: NetworkId

  constructor(network: NetworkId = 'TESTNET') {
    this.network = network
    this.client = new NoirAgentClient()
    this.horizon = new Horizon.Server(NETWORKS[network].horizonUrl)
  }

  get passphrase() { return NETWORKS[this.network].passphrase }
  /** Native XLM's Stellar Asset Contract — what escrow and policies use. */
  get xlm() { return Asset.native().contractId(NETWORKS.TESTNET.passphrase) }

  private requireTestnet() {
    if (this.network !== 'TESTNET') throw new Error('Noir cards run on Testnet. Switch Noir to Testnet first.')
  }

  // ── Reads ─────────────────────────────────────────────────────────

  async account(address: string): Promise<{ exists: boolean; xlm: number; subentries: number }> {
    const res = await fetch(`${NETWORKS[this.network].horizonUrl}/accounts/${address}`)
    if (res.status === 404) return { exists: false, xlm: 0, subentries: 0 }
    if (!res.ok) throw new Error(`Horizon answered ${res.status}.`)
    const a = (await res.json()) as { subentry_count: number; balances: { asset_type: string; balance: string }[] }
    return { exists: true, xlm: Number(a.balances.find((b) => b.asset_type === 'native')?.balance ?? 0), subentries: a.subentry_count }
  }

  private async read(contract: keyof NoirContracts, method: string, args: xdr.ScVal[], nullOn: string[] = []): Promise<xdr.ScVal | null> {
    // Reads need a source account in the envelope but not on the ledger.
    const source = new Account(Keypair.random().publicKey(), '0')
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.client.config.networkPassphrase })
      .addOperation(new Contract(this.client.contracts[contract]).call(method, ...args))
      .setTimeout(30).build()
    const sim = await this.client.server.simulateTransaction(tx)
    if (rpc.Api.isSimulationError(sim)) {
      const err = parseContractError(contract, method, sim.error)
      if (err && nullOn.includes(err.errorName)) return null
      throw err ?? new Error(`${contract}.${method} failed: ${sim.error}`)
    }
    return sim.result?.retval ?? null
  }

  async ownership(deviceHash: string, wallet: string): Promise<Ownership> {
    const d = await this.client.getDevice(deviceHash)
    if (!d) return { status: 'free' }
    return { status: d.owner === wallet ? 'mine' : 'other', ...d }
  }

  async policy(deviceHash: string): Promise<Policy | null> {
    const p = await this.client.getPolicy(deviceHash)
    return p && { agent: p.agent, maxAmount: p.maxAmount, expiresAt: p.expiresAt }
  }

  async card(deviceHash: string, wallet: string): Promise<CardSummary> {
    const [own, policy, escrow] = await Promise.all([this.ownership(deviceHash, wallet), this.policy(deviceHash), this.client.getEscrowBalance(deviceHash)])
    const info = own.status === 'free' ? null : own
    return { deviceHash, agent: policy?.agent ?? info?.agent ?? '', policy, escrow, active: info?.active ?? false, createdAt: info?.createdAt ?? null }
  }

  /** The wallet's cards with what the Cards and Agents screens show. */
  async cards(wallet: string): Promise<CardSummary[]> {
    this.requireTestnet()
    return Promise.all((await this.client.listDevices(wallet)).map((h) => this.card(h, wallet)))
  }

  /**
   * The first agent index nobody uses: not an agent of one of this wallet's
   * cards, not an account that already exists (a retired agent keeps its
   * reserve), not retired here. Stays inside the range the app scans, so the
   * phone rebuilds the agent from the seed.
   */
  async allocateAgent(seed: Uint8Array, wallet: string, retired: number[] = []): Promise<{ index: number; kp: Keypair }> {
    const used = new Set((await this.cards(wallet)).map((c) => c.agent))
    for (let i = 2; i <= AGENT_SCAN; i++) {
      if (retired.includes(i)) continue
      const kp = await deriveAgent(seed, i)
      if (used.has(kp.publicKey())) continue
      if ((await this.account(kp.publicKey())).exists) continue
      return { index: i, kp }
    }
    throw new Error(`All ${AGENT_SCAN - 1} agent keys of this wallet are in use.`)
  }

  // ── Writes ────────────────────────────────────────────────────────

  /** Build and simulate a contract call from `source`; the result carries its full fee. */
  private async prepare(source: string, contract: keyof NoirContracts, method: string, args: xdr.ScVal[]) {
    const account = await this.client.server.getAccount(source)
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.client.config.networkPassphrase })
      .addOperation(new Contract(this.client.contracts[contract]).call(method, ...args))
      .setTimeout(300).build()
    try {
      return await this.client.server.prepareTransaction(tx)
    } catch (e) {
      throw parseContractError(contract, method, String((e as Error)?.message ?? e)) ?? e
    }
  }

  /**
   * Soroban fees include rent for the entries a call creates, and can be more
   * than an account holds above its reserve (a first tap costs ~2.3 XLM on
   * Testnet). Says so plainly instead of txInsufficientBalance.
   */
  private async feeShortfall(source: string, feeStroops: string, payer: string): Promise<string | null> {
    const fee = Number(feeStroops) / 1e7
    const a = await this.account(source)
    const have = spendable(a.xlm, a.subentries, 0)
    if (have >= fee) return null
    return `${payer} needs about ${fee.toFixed(2)} XLM for this transaction’s network fee but has ${have.toFixed(2)} XLM above its reserve.`
  }

  /** Build, simulate, sign as `kp` and wait for a contract call. */
  async invoke(kp: Keypair, contract: keyof NoirContracts, method: string, args: xdr.ScVal[], payer = 'Your wallet'): Promise<string> {
    const prepared = await this.prepare(kp.publicKey(), contract, method, args)
    const lacking = await this.feeShortfall(kp.publicKey(), prepared.fee, payer)
    if (lacking) throw new Error(lacking)
    prepared.sign(kp)
    return this.client.submit(prepared.toXDR())
  }

  private op(kp: Keypair, op: NoirOperation, payer?: string) {
    const { contract, method, args } = toCall(kp.publicKey(), op)
    return this.invoke(kp, contract, method, args, payer)
  }

  private async requireMine(deviceHash: string, wallet: string) {
    const own = await this.ownership(deviceHash, wallet)
    if (own.status === 'other') throw new Error(`This card is linked to another wallet (${short(own.owner)}).`)
    if (own.status === 'free') throw new Error('This card is not linked to your wallet.')
    return own
  }

  private async requireSpendable(wallet: string, xlm: number) {
    const a = await this.account(wallet)
    if (!a.exists) throw new Error('Your wallet is not on the network yet. Fund it first.')
    const can = spendable(a.xlm, a.subentries)
    if (xlm > can) throw new Error(`Not enough XLM: ${can.toFixed(2)} XLM available after the network reserve.`)
  }

  /**
   * Link a tag: device_registry.register with a fresh agent, then
   * agent_registry.register_agent with its policy. Resumes a link that
   * stopped between the two calls.
   */
  async link(p: { wallet: Keypair; seed: Uint8Array; deviceHash: string; maxXlm?: number; expiryDays?: number; retired?: number[] }) {
    this.requireTestnet()
    const pub = p.wallet.publicKey()
    const policy = buildPolicy(p.maxXlm ?? DEFAULT_CAP_XLM, p.expiryDays ?? 0)
    const own = await this.ownership(p.deviceHash, pub)
    if (own.status === 'other') throw new Error(`This card is already linked to another wallet (${short(own.owner)}).`)
    if (own.status === 'mine' && !own.active) throw new Error('This card was revoked. Unlink it, then link it again.')
    await this.requireSpendable(pub, 0.1)

    let agent: string
    if (own.status === 'mine') {
      agent = own.agent
      if (await this.policy(p.deviceHash)) return { deviceHash: p.deviceHash, agent, alreadyLinked: true }
    } else {
      agent = (await this.allocateAgent(p.seed, pub, p.retired)).kp.publicKey()
      await this.op(p.wallet, { kind: 'registerDevice', deviceHash: p.deviceHash, agent })
    }
    await this.op(p.wallet, { kind: 'registerAgent', deviceHash: p.deviceHash, agent, asset: this.xlm, ...policy })
    return { deviceHash: p.deviceHash, agent, alreadyLinked: false }
  }

  /** Replace the policy: register_agent refuses to overwrite, so revoke first. */
  async setPolicy(wallet: Keypair, deviceHash: string, maxXlm: number, expiryDays: number) {
    this.requireTestnet()
    const policy = buildPolicy(maxXlm, expiryDays)
    const own = await this.requireMine(deviceHash, wallet.publicKey())
    const current = await this.policy(deviceHash)
    const agent = current?.agent ?? own.agent
    if (current) await this.op(wallet, { kind: 'revokeAgent', deviceHash })
    return this.op(wallet, { kind: 'registerAgent', deviceHash, agent, asset: this.xlm, ...policy })
  }

  async fundEscrow(wallet: Keypair, deviceHash: string, xlm: number) {
    this.requireTestnet()
    // An escrow for a tag this wallet doesn't own could never be withdrawn.
    await this.requireMine(deviceHash, wallet.publicKey())
    await this.requireSpendable(wallet.publicKey(), xlm)
    return this.op(wallet, { kind: 'fundEscrow', deviceHash, token: this.xlm, amount: toStroops(xlm) })
  }

  async withdrawEscrow(wallet: Keypair, deviceHash: string, xlm: number) {
    this.requireTestnet()
    const balance = await this.client.getEscrowBalance(deviceHash)
    if (toStroops(xlm) > balance) throw new Error(`Only ${fromStroops(balance)} XLM is in this card’s escrow.`)
    return this.op(wallet, { kind: 'defundEscrow', deviceHash, token: this.xlm, amount: toStroops(xlm) })
  }

  /** Send XLM to a card's agent account (creating it on the first top-up). */
  topUpAgent(wallet: Keypair, agent: string, xlm: number) {
    this.requireTestnet()
    return this.pay(wallet, agent, xlm)
  }

  // ── Tap to pay (payment_escrow.authorize → claim) ─────────────────

  /** XLM waiting in payment_escrow for `merchant` to claim. */
  async pendingClaims(merchant: string): Promise<number> {
    this.requireTestnet()
    return fromStroops(await this.client.getPendingBalance(merchant))
  }

  /**
   * Why a tap for `xlm` from this card's escrow would be refused, checked
   * before anything is signed: the contract's own check_payment, the escrow
   * balance, and the agent account that pays the network fee.
   */
  async tapCheck(deviceHash: string, agent: string, xlm: number): Promise<string | null> {
    const check = await this.client.checkPayment({ deviceHash, agent, asset: this.xlm, amount: toStroops(xlm) })
    if (!check.ok) {
      switch (check.reason) {
        case 'no_agent': return 'This card has no agent authorized to pay. Finish linking it first.'
        case 'wrong_agent': return 'This card’s policy names a different agent.'
        case 'wrong_asset': return 'This card’s agent may only spend another asset.'
        case 'invalid_amount': return 'Enter an amount greater than zero.'
        case 'over_limit': {
          const p = await this.policy(deviceHash)
          return `Over this card’s limit of ${p ? fromStroops(p.maxAmount) : '?'} XLM per tap.`
        }
        case 'expired': return 'This card’s agent policy has expired. Edit the policy to renew it.'
        case 'insufficient_escrow':
          return `The card’s escrow only holds ${fromStroops(await this.client.getEscrowBalance(deviceHash))} XLM. Add funds to the card first.`
      }
    }
    if (!(await this.account(agent)).exists) {
      return `The card’s agent account isn’t open yet. Top up the agent (${AGENT_TOPUP_XLM} XLM is a good start): it pays the network fee for each tap.`
    }
    // Simulate the tap itself: its fee depends on what it writes.
    const { contract, method, args } = toCall(agent, this.authorizeOp(deviceHash, Keypair.random().publicKey(), xlm))
    const prepared = await this.prepare(agent, contract, method, args)
    const lacking = await this.feeShortfall(agent, prepared.fee, 'The card’s agent')
    return lacking && `${lacking} Top up the agent.`
  }

  private authorizeOp(deviceHash: string, merchant: string, xlm: number): NoirOperation {
    return { kind: 'authorize', deviceHash, merchant, asset: this.xlm, amount: toStroops(xlm), nonce: BigInt(Date.now()) }
  }

  /**
   * The tap itself: the card's agent signs payment_escrow.authorize, moving
   * `xlm` from the card's escrow to a pending payment for `merchant`, within
   * the policy agent_registry enforces. The nonce only has to increase per
   * (card, agent); milliseconds since epoch do.
   */
  async authorize(agentKp: Keypair, deviceHash: string, merchant: string, xlm: number): Promise<string> {
    this.requireTestnet()
    if (!isAddress(merchant)) throw new Error('That is not a Stellar address (G…).')
    const refused = await this.tapCheck(deviceHash, agentKp.publicKey(), xlm)
    if (refused) throw new Error(refused)
    return this.op(agentKp, this.authorizeOp(deviceHash, merchant, xlm), 'The card’s agent')
  }

  /** The merchant collects every pending XLM payment into its wallet. */
  async claim(merchant: Keypair): Promise<{ hash: string; xlm: number }> {
    this.requireTestnet()
    const xlm = await this.pendingClaims(merchant.publicKey())
    if (xlm <= 0) throw new Error('Nothing is waiting to be claimed.')
    return { hash: await this.op(merchant, { kind: 'claim', token: this.xlm }), xlm }
  }

  /**
   * Charge one of this wallet's own cards, the Noir app's POS "Receive":
   * authorize from its escrow to this wallet, then claim, so the XLM lands.
   */
  async charge(wallet: Keypair, agentKp: Keypair, deviceHash: string, xlm: number) {
    const own = await this.requireMine(deviceHash, wallet.publicKey())
    if (!own.active) throw new Error('This card was revoked and can’t pay.')
    const authorizeHash = await this.authorize(agentKp, deviceHash, wallet.publicKey(), xlm)
    const { hash: claimHash } = await this.claim(wallet)
    return { authorizeHash, claimHash }
  }

  /**
   * Who a tapped card pays when you *send* to it (frontend/src/lib/cardTap.ts):
   * someone else's card pays its owner; your own card pays its agent account.
   */
  async cardRecipient(deviceHash: string, wallet: string): Promise<{ address: string; mine: boolean }> {
    const own = await this.ownership(deviceHash, wallet)
    if (own.status === 'free') throw new Error('This card isn’t linked to a Noir account, so there’s no one to pay.')
    if (!own.active) throw new Error('This card was revoked.')
    if (own.status === 'mine') return { address: (await this.policy(deviceHash))?.agent ?? own.agent, mine: true }
    return { address: own.owner, mine: false }
  }

  /**
   * Unlink without stranding funds. Order matters: revoke_agent (sweep refuses
   * while an agent is live) → sweep_on_revoke (escrow back to the owner) →
   * device revoke (after which the owner can't be resolved). Then the agent
   * account's own XLM above its reserve goes back too. Every step is decided
   * by a read, so a retry after a failure picks up where it stopped.
   */
  async unlink(wallet: Keypair, deviceHash: string, agentKp: Keypair | null) {
    this.requireTestnet()
    const pub = wallet.publicKey()
    const [own, policy, escrow] = await Promise.all([this.ownership(deviceHash, pub), this.policy(deviceHash), this.client.getEscrowBalance(deviceHash)])
    if (own.status === 'other') throw new Error('This card is linked to another wallet.')
    if (policy) await this.op(wallet, { kind: 'revokeAgent', deviceHash })
    if (escrow > 0n) {
      if (own.status !== 'mine') throw new Error('Escrow remains but the card is no longer registered.')
      await this.op(wallet, { kind: 'sweepOnRevoke', deviceHash, token: this.xlm, agent: policy?.agent ?? own.agent })
    }
    if (own.status === 'mine') await this.op(wallet, { kind: 'revokeDevice', deviceHash })

    let agentSwept = 0
    if (agentKp) {
      const a = await this.account(agentKp.publicKey())
      const amount = Math.floor(spendable(a.xlm, a.subentries, 0.01) * 1e7) / 1e7
      if (a.exists && amount > 0) {
        await this.pay(agentKp, pub, amount)
        agentSwept = amount
      }
    }
    return { escrowReturned: fromStroops(escrow), agentSwept }
  }

  /** Payment, or createAccount when the destination isn't on the network yet. */
  async pay(from: Keypair, destination: string, xlm: number, memo?: string): Promise<string> {
    if (!isAddress(destination)) throw new Error('That is not a Stellar address (G…).')
    if (destination === from.publicKey()) throw new Error('That is this wallet’s own address.')
    if (memo && !memoOk(memo)) throw new Error(`A memo is at most ${MEMO_MAX_BYTES} bytes.`)
    await this.requireSpendable(from.publicKey(), xlm)
    const dest = await this.account(destination)
    if (!dest.exists && xlm < MIN_CREATE_XLM) {
      throw new Error(`That account isn’t on the network yet. Send at least ${MIN_CREATE_XLM} XLM to open it.`)
    }
    const source = await this.horizon.loadAccount(from.publicKey())
    const builder = new TransactionBuilder(source, { fee: String(await this.horizon.fetchBaseFee()), networkPassphrase: this.passphrase })
      .addOperation(dest.exists
        ? Operation.payment({ destination, asset: Asset.native(), amount: toAmount(xlm) })
        : Operation.createAccount({ destination, startingBalance: toAmount(xlm) }))
      .setTimeout(180)
    if (memo) builder.addMemo(Memo.text(memo))
    const tx = builder.build()
    tx.sign(from)
    try {
      return (await this.horizon.submitTransaction(tx)).hash
    } catch (e) {
      const codes = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } })
        ?.response?.data?.extras?.result_codes
      if (codes) throw new Error(`The network refused the payment (${[codes.transaction, ...(codes.operations ?? [])].filter(Boolean).join(', ')}).`)
      throw e
    }
  }
}

// ── Payment requests (frontend/src/lib/paymentQr.ts) ────────────────

export interface PaymentRequest { destination: string; amount?: string; memo?: string }

const SEP7 = 'web+stellar:pay?'

/** SEP-0007 pay URI, the format the app's Receive QR uses, so any Stellar wallet can scan it. */
export function paymentUri(req: PaymentRequest): string {
  const parts: [string, string][] = [['destination', req.destination]]
  if (req.amount && Number(req.amount) > 0) parts.push(['amount', toAmount(Number(req.amount))])
  if (req.memo?.trim()) parts.push(['memo', req.memo.trim()], ['memo_type', 'MEMO_TEXT'])
  return SEP7 + parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
}

/** A pasted address, SEP-7 pay URI or the app's older `G…?asset=XLM`; null when it isn't payable. */
export function parsePaymentRequest(raw: string): PaymentRequest | null {
  const text = raw.trim()
  if (text.toLowerCase().startsWith(SEP7)) {
    let q: URLSearchParams
    try { q = new URLSearchParams(text.slice(SEP7.length)) } catch { return null }
    const destination = q.get('destination')?.trim() ?? ''
    if (!isAddress(destination)) return null
    const asset = q.get('asset_code')
    if (asset && asset.toUpperCase() !== 'XLM') return null
    const out: PaymentRequest = { destination }
    const amount = q.get('amount')
    if (amount && /^\d+(\.\d{1,7})?$/.test(amount) && Number(amount) > 0) out.amount = amount
    const memo = q.get('memo')
    if (memo && (q.get('memo_type') ?? 'MEMO_TEXT').toUpperCase() === 'MEMO_TEXT' && memoOk(memo)) out.memo = memo
    return out
  }
  const destination = text.split('?')[0]
  return isAddress(destination) ? { destination } : null
}

// ── Activity (Horizon /accounts/:id/payments?join=transactions) ─────

export interface HorizonOp {
  id: string
  type: string
  created_at: string
  transaction_hash: string
  transaction_successful?: boolean
  from?: string; to?: string; amount?: string; asset_type?: string; asset_code?: string
  funder?: string; account?: string; starting_balance?: string
  source_account?: string
  function?: string
  asset_balance_changes?: { from?: string; to?: string; amount: string; asset_type: string; asset_code?: string }[]
  transaction?: { memo?: string; memo_type?: string; fee_charged?: string | number; successful?: boolean }
}

export interface ActivityItem {
  id: string
  hash: string
  at: string
  direction: 'in' | 'out' | 'self'
  /** What happened, in a few words. */
  title: string
  amount: number | null
  asset: string
  counterparty: string | null
  memo: string | null
  feeXlm: number | null
  ok: boolean
}

/** One Horizon payments-stream record, from the point of view of `me`. */
export function toActivity(op: HorizonOp, me: string): ActivityItem {
  const tx = op.transaction
  const base = {
    id: op.id, hash: op.transaction_hash, at: op.created_at,
    memo: tx?.memo_type === 'text' && tx.memo ? tx.memo : null,
    feeXlm: tx?.fee_charged != null ? Number(tx.fee_charged) / 1e7 : null,
    ok: tx?.successful ?? op.transaction_successful ?? true,
  }
  const asset = (t?: string, c?: string) => (t === 'native' || !t ? 'XLM' : c ?? t)
  switch (op.type) {
    case 'create_account': {
      const out = op.funder === me
      return { ...base, direction: out ? 'out' : 'in', title: out ? 'Opened an account' : 'Account opened', amount: Number(op.starting_balance), asset: 'XLM', counterparty: (out ? op.account : op.funder) ?? null }
    }
    case 'payment':
    case 'path_payment_strict_send':
    case 'path_payment_strict_receive': {
      const dir = op.from === me && op.to === me ? 'self' : op.from === me ? 'out' : 'in'
      return { ...base, direction: dir, title: dir === 'out' ? 'Sent' : dir === 'in' ? 'Received' : 'Moved', amount: Number(op.amount), asset: asset(op.asset_type, op.asset_code), counterparty: (dir === 'out' ? op.to : op.from) ?? null }
    }
    case 'invoke_host_function': {
      // Token movements the contract made: escrow deposits, withdrawals, sweeps.
      const changes = op.asset_balance_changes ?? []
      const mine = changes.find((c) => c.from === me || c.to === me)
      const out = mine?.from === me
      return {
        ...base, direction: mine ? (out ? 'out' : 'in') : 'self',
        title: mine ? (out ? 'Contract deposit' : 'Contract payout') : 'Contract call',
        amount: mine ? Number(mine.amount) : null, asset: asset(mine?.asset_type, mine?.asset_code),
        counterparty: (mine ? (out ? mine.to : mine.from) : null) ?? null,
      }
    }
    default:
      return { ...base, direction: 'self', title: op.type.replace(/_/g, ' '), amount: op.amount ? Number(op.amount) : null, asset: 'XLM', counterparty: null }
  }
}

// ── Payment requests that watch for the payment (components/flow/PaymentRequestQr.tsx) ──

export interface PaymentRecord {
  id: string; type: string; transaction_hash: string
  to?: string; from?: string; amount?: string; asset_type?: string
  account?: string; funder?: string; starting_balance?: string
}

/** The first XLM payment to `me` among `records` that covers `want` (0 = any amount). */
export function matchIncoming(records: PaymentRecord[], me: string, want: number): { hash: string; from: string; amount: number } | null {
  for (const r of records) {
    const hit = r.type === 'payment' && r.to === me && r.from !== me && r.asset_type === 'native'
      ? { amount: Number(r.amount), from: r.from! }
      : r.type === 'create_account' && r.account === me ? { amount: Number(r.starting_balance), from: r.funder! } : null
    // Small tolerance for float formatting; a short payment doesn't settle the request.
    if (hit && (!want || hit.amount + 1e-7 >= want)) return { hash: r.transaction_hash, ...hit }
  }
  return null
}
