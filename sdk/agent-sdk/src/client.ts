import {
  Account, Address, Contract, Keypair, TransactionBuilder, BASE_FEE, nativeToScVal, scValToNative, rpc, xdr,
} from '@stellar/stellar-sdk'
import { TESTNET, type NoirContracts, type NoirNetworkConfig } from './networks.js'
import { deviceHashScVal, normalizeDeviceHash } from './hash.js'
import { signWith, type NoirSigner } from './signer.js'
import { decodeEvent, type NoirEvent, type NoirEventType } from './events.js'
import { NoirContractError, parseContractError } from './errors.js'
import { toHex } from './bytes.js'

/** The constrained authorization a wallet owner gave one agent key for one device. */
export interface NoirAgentPolicy {
  agent: string
  /** Per-payment cap in the asset's smallest unit (stroops for XLM). `0n` = no cap. */
  maxAmount: bigint
  /** Token contract the agent may spend. */
  asset: string
  /** When the authorization lapses, or null if it never does. */
  expiresAt: Date | null
}

/** A device's record in device_registry. */
export interface NoirDeviceInfo {
  /** Wallet that registered the device. */
  owner: string
  /** Agent key linked to the device at registration. */
  agent: string
  /** True while the device is usable (on-chain `status === 0`). */
  active: boolean
  /** When the device was registered, or null if the ledger time is missing. */
  createdAt: Date | null
}

export type PaymentRefusal =
  | 'no_agent' | 'wrong_agent' | 'wrong_asset' | 'invalid_amount' | 'over_limit' | 'expired' | 'insufficient_escrow'

export type PaymentCheck = { ok: true } | { ok: false; reason: PaymentRefusal }

export interface NoirAgentClientOptions {
  /** `'testnet'` (default) or a full config for your own deployment. */
  network?: 'testnet' | NoirNetworkConfig
  /** Overrides the network's RPC endpoint. */
  rpcUrl?: string
}

export interface WatchOptions {
  onEvent: (event: NoirEvent) => void | Promise<void>
  onError?: (error: unknown) => void
  /** Only these event types. Default: all. */
  types?: NoirEventType[]
  /** Only events about this device (merchant-only claims are dropped). */
  deviceHash?: string
  /** Only events involving this merchant. */
  merchant?: string
  /** Ledger to start from. Default: the latest ledger (new events only). */
  fromLedger?: number
  /** Poll interval. Default 5s (Stellar closes a ledger about every 5s). */
  pollMs?: number
}

/**
 * Every write a Noir integration can make. The acting account (the one that
 * signs) is implied: the agent for `authorize`, the merchant for `claim`, the
 * device owner for the rest.
 *
 * Never send `revokeDevice` while the device still has escrow: the escrow
 * resolves its owner through device_registry, so the funds would be stranded.
 * `NoirAgentClient.unlinkDevice` runs the safe order for you.
 */
export type NoirOperation =
  | { kind: 'registerDevice'; deviceHash: string; agent: string }
  | { kind: 'revokeDevice'; deviceHash: string }
  | { kind: 'authorize'; deviceHash: string; merchant: string; asset: string; amount: bigint; nonce: bigint }
  | { kind: 'claim'; token: string }
  | { kind: 'registerAgent'; deviceHash: string; agent: string; asset: string; maxAmount: bigint; expiresAt?: Date | null }
  | { kind: 'revokeAgent'; deviceHash: string }
  | { kind: 'fundEscrow'; deviceHash: string; token: string; amount: bigint }
  | { kind: 'defundEscrow'; deviceHash: string; token: string; amount: bigint }
  | { kind: 'sweepOnRevoke'; deviceHash: string; token: string; agent: string }

export type NoirOperationKind = NoirOperation['kind']

const OP_CONTRACT: Record<NoirOperationKind, keyof NoirContracts> = {
  registerDevice: 'deviceRegistry', revokeDevice: 'deviceRegistry',
  authorize: 'paymentEscrow', claim: 'paymentEscrow', fundEscrow: 'paymentEscrow', defundEscrow: 'paymentEscrow',
  sweepOnRevoke: 'paymentEscrow',
  registerAgent: 'agentRegistry', revokeAgent: 'agentRegistry',
}
const OP_METHOD: Record<NoirOperationKind, string> = {
  registerDevice: 'register', revokeDevice: 'revoke',
  authorize: 'authorize', claim: 'claim', fundEscrow: 'fund_escrow', defundEscrow: 'defund_escrow',
  sweepOnRevoke: 'sweep_on_revoke',
  registerAgent: 'register_agent', revokeAgent: 'revoke_agent',
}

/** Contract call for `op`, with `source` filled in wherever the contract wants the acting address. */
export function toCall(source: string, op: NoirOperation): { contract: keyof NoirContracts; method: string; args: xdr.ScVal[] } {
  const a = (s: string) => new Address(s).toScVal()
  const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })
  const args = ((): xdr.ScVal[] => {
    switch (op.kind) {
      case 'registerDevice':
        return [a(source), deviceHashScVal(op.deviceHash), a(op.agent)]
      case 'revokeDevice':
        return [a(source), deviceHashScVal(op.deviceHash)]
      case 'sweepOnRevoke':
        return [a(op.token), deviceHashScVal(op.deviceHash), a(op.agent)]
      case 'authorize':
        return [a(source), deviceHashScVal(op.deviceHash), a(op.merchant), a(op.asset), i128(op.amount), nativeToScVal(op.nonce, { type: 'u64' })]
      case 'claim':
        return [a(op.token), a(source)]
      case 'registerAgent': {
        const exp = op.expiresAt ? BigInt(Math.floor(op.expiresAt.getTime() / 1000)) : 0n
        return [a(source), deviceHashScVal(op.deviceHash), a(op.agent), i128(op.maxAmount), a(op.asset), nativeToScVal(exp, { type: 'u64' })]
      }
      case 'revokeAgent':
        return [a(source), deviceHashScVal(op.deviceHash)]
      case 'fundEscrow':
        return [a(op.token), a(source), deviceHashScVal(op.deviceHash), i128(op.amount)]
      case 'defundEscrow':
        return [a(op.token), deviceHashScVal(op.deviceHash), i128(op.amount)]
    }
  })()
  return { contract: OP_CONTRACT[op.kind], method: OP_METHOD[op.kind], args }
}

const TX_POLL_MS = 1000
const TX_TIMEOUT_MS = 60_000
const EVENTS_PAGE = 100

/**
 * Talks to Noir's three contracts over Soroban RPC. Reads need no account;
 * writes take a NoirSigner (a wallet such as Freighter / Wallets Kit, or
 * `keypairSigner` on a server), so this SDK never handles a user's secret.
 */
export class NoirAgentClient {
  readonly config: NoirNetworkConfig
  readonly server: rpc.Server

  constructor(opts: NoirAgentClientOptions = {}) {
    const base = !opts.network || opts.network === 'testnet' ? TESTNET : opts.network
    this.config = { ...base, rpcUrl: opts.rpcUrl ?? base.rpcUrl }
    this.server = new rpc.Server(this.config.rpcUrl, { allowHttp: this.config.rpcUrl.startsWith('http://') })
  }

  get contracts(): NoirContracts { return this.config.contracts }

  // ── Reads ─────────────────────────────────────────────────────────

  /** The device's agent policy, or null when no agent is registered for it. */
  async getPolicy(deviceHash: string): Promise<NoirAgentPolicy | null> {
    const val = await this.read('agentRegistry', 'get_policy', [deviceHashScVal(deviceHash)], ['AgentNotFound'])
    if (!val) return null
    const p = scValToNative(val) as { agent: string; max_amount: bigint; asset: string; expires_at: bigint }
    const exp = BigInt(p.expires_at)
    return {
      agent: String(p.agent),
      maxAmount: BigInt(p.max_amount),
      asset: String(p.asset),
      expiresAt: exp === 0n ? null : new Date(Number(exp) * 1000),
    }
  }

  /** The device's full record (owner, agent, active, registration time), or null when not registered. */
  async getDevice(deviceHash: string): Promise<NoirDeviceInfo | null> {
    const val = await this.read('deviceRegistry', 'get_device', [deviceHashScVal(deviceHash)], ['DeviceNotFound'])
    return val ? parseDeviceInfo(val) : null
  }

  /**
   * device_registry.is_authorized: true when `agent` is the device's linked
   * agent and the device is active. False for unknown devices. This is the
   * device-side check; spend limits live in `checkPayment`.
   */
  async isDeviceAuthorized(deviceHash: string, agent: string): Promise<boolean> {
    const val = await this.read('deviceRegistry', 'is_authorized', [deviceHashScVal(deviceHash), new Address(agent).toScVal()])
    return scValToNative(val!) === true
  }

  /** The wallet that owns the device, or null when the device is not registered. */
  async getDeviceOwner(deviceHash: string): Promise<string | null> {
    const val = await this.read('deviceRegistry', 'get_owner', [deviceHashScVal(deviceHash)], ['DeviceNotFound'])
    return val ? String(scValToNative(val)) : null
  }

  /** Device hashes registered to a wallet, oldest first. */
  async listDevices(wallet: string): Promise<string[]> {
    const owner = new Address(wallet).toScVal()
    const count = Number(scValToNative((await this.read('deviceRegistry', 'wallet_device_count', [owner]))!))
    const out: string[] = []
    for (let i = 0; i < count; i++) {
      const val = await this.read('deviceRegistry', 'wallet_device_at', [owner, nativeToScVal(i, { type: 'u32' })], ['DeviceNotFound'])
      if (val) out.push(toHex(scValToNative(val) as Uint8Array))
    }
    return out
  }

  /** Funds held in escrow for the device (smallest unit). */
  async getEscrowBalance(deviceHash: string): Promise<bigint> {
    const val = await this.read('paymentEscrow', 'balance_of', [deviceHashScVal(deviceHash)])
    return BigInt(scValToNative(val!))
  }

  /** Token the device's escrow is bound to (set by its first fund), or null before any funding. */
  async getEscrowToken(deviceHash: string): Promise<string | null> {
    const val = await this.read('paymentEscrow', 'escrow_token', [deviceHashScVal(deviceHash)])
    const token = val ? scValToNative(val) : null
    return token == null ? null : String(token)
  }

  /** What a merchant can claim right now (smallest unit). */
  async getPendingBalance(merchant: string): Promise<bigint> {
    const val = await this.read('paymentEscrow', 'pending_balance', [new Address(merchant).toScVal()])
    return BigInt(scValToNative(val!))
  }

  /**
   * Would `payment_escrow.authorize` accept this payment? Uses the contract's
   * own `check_payment` predicate (so the rules match exactly) plus the escrow
   * balance, and names the reason when it would not.
   */
  async checkPayment(p: { deviceHash: string; agent: string; asset: string; amount: bigint; requireEscrow?: boolean }): Promise<PaymentCheck> {
    if (p.amount <= 0n) return { ok: false, reason: 'invalid_amount' }
    const allowedVal = await this.read('agentRegistry', 'check_payment', [
      deviceHashScVal(p.deviceHash),
      new Address(p.agent).toScVal(),
      new Address(p.asset).toScVal(),
      nativeToScVal(p.amount, { type: 'i128' }),
    ])
    if (!scValToNative(allowedVal!)) {
      const policy = await this.getPolicy(p.deviceHash)
      return { ok: false, reason: refusalReason(policy, p) }
    }
    if (p.requireEscrow !== false && (await this.getEscrowBalance(p.deviceHash)) < p.amount) {
      return { ok: false, reason: 'insufficient_escrow' }
    }
    return { ok: true }
  }

  // ── Writes ────────────────────────────────────────────────────────

  /**
   * Tap-to-pay: the agent key spends from the device escrow to a merchant,
   * within its policy. `nonce` must increase per (device, agent); the default
   * (milliseconds since epoch) does. The merchant collects with `claim`.
   */
  async authorizePayment(p: {
    agent: NoirSigner; deviceHash: string; merchant: string; asset: string; amount: bigint; nonce?: bigint
  }): Promise<{ hash: string; nonce: bigint }> {
    const nonce = p.nonce ?? BigInt(Date.now())
    const { deviceHash, merchant, asset, amount } = p
    const { hash } = await this.execute(p.agent, { kind: 'authorize', deviceHash, merchant, asset, amount, nonce })
    return { hash, nonce }
  }

  /** Merchant collects every pending payment in `token`. */
  async claim(p: { merchant: NoirSigner; token: string }): Promise<{ hash: string }> {
    return this.execute(p.merchant, { kind: 'claim', token: p.token })
  }

  /**
   * Removes a device without stranding its escrow: revoke_agent (the sweep
   * refuses while an agent is live) → sweep_on_revoke (whole balance back to
   * the owner) → device revoke (after which the owner can't be resolved).
   * Each step is decided by a read, so a retry after a failure resumes.
   * `owner` must be the device's current owner.
   */
  async unlinkDevice(p: { owner: NoirSigner; deviceHash: string }): Promise<{ hashes: string[]; escrowReturned: bigint }> {
    const { owner, deviceHash } = p
    const [current, policy, escrow, token] = await Promise.all([
      this.getDeviceOwner(deviceHash), this.getPolicy(deviceHash),
      this.getEscrowBalance(deviceHash), this.getEscrowToken(deviceHash),
    ])
    if (current && current !== owner.publicKey) throw new Error('unlinkDevice: the device belongs to another wallet')
    if (!current && escrow > 0n) throw new Error('unlinkDevice: escrow remains but the device is no longer registered')

    const hashes: string[] = []
    if (policy) hashes.push((await this.execute(owner, { kind: 'revokeAgent', deviceHash })).hash)
    if (escrow > 0n && token) {
      // sweep_on_revoke takes the agent that was revoked; fall back to the device record's agent.
      const agent = policy?.agent ?? (await this.getDeviceAgent(deviceHash))
      if (!agent) throw new Error('unlinkDevice: cannot resolve the device agent to sweep')
      hashes.push((await this.execute(owner, { kind: 'sweepOnRevoke', deviceHash, token, agent })).hash)
    }
    if (current) hashes.push((await this.execute(owner, { kind: 'revokeDevice', deviceHash })).hash)
    return { hashes, escrowReturned: escrow }
  }

  /** The agent recorded for the device in device_registry, or null when the device is not registered. */
  async getDeviceAgent(deviceHash: string): Promise<string | null> {
    const val = await this.read('deviceRegistry', 'get_agent', [deviceHashScVal(deviceHash)], ['DeviceNotFound'])
    return val ? String(scValToNative(val)) : null
  }

  /**
   * Runs any Noir operation: builds it with the signer as the acting account,
   * simulates, signs, submits and waits for confirmation.
   */
  async execute(signer: NoirSigner, op: NoirOperation): Promise<{ hash: string }> {
    const unsigned = await this.prepare(signer.publicKey, op)
    const signed = await signWith(signer, unsigned, this.config.networkPassphrase)
    return { hash: await this.submit(signed, op) }
  }

  /**
   * Builds and simulates `op` for `source` (the account whose require_auth the
   * contract checks) and returns the unsigned transaction XDR. Use this when
   * signing happens somewhere else (a browser wallet, a hardware key, or the
   * other side of the Noir API), then pass the signed XDR to `submit`.
   */
  async prepare(source: string, op: NoirOperation): Promise<string> {
    const { contract, method, args } = toCall(source, op)
    const account = await this.server.getAccount(source)
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: this.config.networkPassphrase })
      .addOperation(new Contract(this.contracts[contract]).call(method, ...args))
      .setTimeout(300)
      .build()
    try {
      return (await this.server.prepareTransaction(tx)).toXDR()
    } catch (e) {
      throw parseContractError(contract, method, String((e as Error)?.message ?? e)) ?? e
    }
  }

  /** Submits a signed transaction XDR and resolves with its hash once the network confirms it. */
  async submit(signedXdr: string, op?: NoirOperation): Promise<string> {
    const label = op ? `${OP_CONTRACT[op.kind]}.${OP_METHOD[op.kind]}` : 'transaction'
    const signed = TransactionBuilder.fromXDR(signedXdr, this.config.networkPassphrase)
    const sent = await this.server.sendTransaction(signed)
    if (sent.status === 'ERROR') {
      throw new Error(`${label} rejected by the network: ${sent.errorResult?.result().switch().name ?? 'unknown'}`)
    }

    const deadline = Date.now() + TX_TIMEOUT_MS
    for (;;) {
      const got = await this.server.getTransaction(sent.hash)
      if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash
      if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
        // Contract refusals normally surface at simulation; this is a race (state changed in between).
        throw new Error(`${label} failed on-chain (${sent.hash})`)
      }
      if (Date.now() > deadline) throw new Error(`${label} not confirmed after ${TX_TIMEOUT_MS / 1000}s (${sent.hash})`)
      await new Promise((r) => setTimeout(r, TX_POLL_MS))
    }
  }

  // ── Events ────────────────────────────────────────────────────────

  /** One page of Noir events, from a ledger or from a previous page's cursor. */
  async getEvents(q: { startLedger?: number; cursor?: string; limit?: number } = {}): Promise<{ events: NoirEvent[]; cursor: string; latestLedger: number }> {
    const filters = [{ type: 'contract' as const, contractIds: Object.values(this.contracts) }]
    const limit = q.limit ?? EVENTS_PAGE
    const res = q.cursor
      ? await this.server.getEvents({ filters, cursor: q.cursor, limit })
      : await this.server.getEvents({ filters, startLedger: q.startLedger ?? (await this.server.getLatestLedger()).sequence, limit })
    const events = res.events.map((e) => decodeEvent(e, this.contracts)).filter((e): e is NoirEvent => e !== null)
    return { events, cursor: res.cursor, latestLedger: res.latestLedger }
  }

  /**
   * Every Noir event from `fromLedger` up to the latest ledger, oldest first.
   * RPC keeps about 7 days of events; older ledgers are rejected.
   */
  async pastEvents(fromLedger: number): Promise<NoirEvent[]> {
    const out: NoirEvent[] = []
    let page = await this.getEvents({ startLedger: fromLedger })
    out.push(...page.events)
    while (!caughtUp(page)) {
      page = await this.getEvents({ cursor: page.cursor })
      out.push(...page.events)
    }
    return out
  }

  /**
   * Calls `onEvent` for each new Noir event, in order, until the returned
   * function is called. Errors go to `onError` and polling carries on.
   */
  watch(opts: WatchOptions): () => void {
    const pollMs = opts.pollMs ?? 5000
    const device = opts.deviceHash ? normalizeDeviceHash(opts.deviceHash) : null
    let stopped = false
    let cursor: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const matches = (e: NoirEvent) =>
      (!opts.types || opts.types.includes(e.type)) &&
      (!device || ('deviceHash' in e && e.deviceHash === device)) &&
      (!opts.merchant || ('merchant' in e && e.merchant === opts.merchant))

    const tick = async () => {
      try {
        // Drain up to the latest ledger before sleeping. RPC scans a bounded
        // ledger window per call, so an empty page doesn't mean caught up.
        for (;;) {
          const page = cursor
            ? await this.getEvents({ cursor })
            : await this.getEvents({ startLedger: opts.fromLedger })
          cursor = page.cursor
          for (const e of page.events) {
            if (stopped) return
            if (matches(e)) await opts.onEvent(e)
          }
          if (stopped || caughtUp(page)) break
        }
      } catch (e) {
        opts.onError?.(e)
      }
      if (!stopped) timer = setTimeout(tick, pollMs)
    }
    void tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }

  // ── Internals ─────────────────────────────────────────────────────

  /** Simulates a read-only call. Returns null when it fails with one of `nullOn`. */
  private async read(contract: keyof NoirContracts, method: string, args: xdr.ScVal[], nullOn: string[] = []): Promise<xdr.ScVal | null> {
    // Reads need a source account in the envelope but not on the ledger.
    const source = new Account(Keypair.random().publicKey(), '0')
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: this.config.networkPassphrase })
      .addOperation(new Contract(this.contracts[contract]).call(method, ...args))
      .setTimeout(30)
      .build()
    const sim = await this.server.simulateTransaction(tx)
    if (rpc.Api.isSimulationError(sim)) {
      const err = parseContractError(contract, method, sim.error)
      if (err && nullOn.includes(err.errorName)) return null
      throw err ?? new Error(`${contract}.${method} simulation failed: ${sim.error}`)
    }
    if (!sim.result) throw new Error(`${contract}.${method} returned no result`)
    return sim.result.retval
  }
}

/** Decodes a device_registry `DeviceInfo` ScVal. */
export function parseDeviceInfo(val: xdr.ScVal): NoirDeviceInfo {
  const d = scValToNative(val) as { owner: string; agent: string; status: number; created_at: bigint | number }
  const created = Number(d.created_at)
  return {
    owner: String(d.owner),
    agent: String(d.agent),
    active: Number(d.status) === 0,
    createdAt: Number.isFinite(created) && created > 0 ? new Date(created * 1000) : null,
  }
}

/** Ledger a getEvents cursor points at (cursors are TOIDs: ledger << 32 | tx/op). */
export function cursorLedger(cursor: string): number {
  const toid = /^(\d+)/.exec(cursor)?.[1]
  return toid ? Number(BigInt(toid) >> 32n) : 0
}

function caughtUp(page: { events: unknown[]; cursor: string; latestLedger: number }): boolean {
  return page.events.length < EVENTS_PAGE && cursorLedger(page.cursor) >= page.latestLedger
}

/** Mirrors agent_registry.check_payment to say which rule refused the payment. */
export function refusalReason(
  policy: NoirAgentPolicy | null,
  p: { agent: string; asset: string; amount: bigint },
  now: Date = new Date(),
): PaymentRefusal {
  if (!policy) return 'no_agent'
  if (policy.agent !== p.agent) return 'wrong_agent'
  if (policy.asset !== p.asset) return 'wrong_asset'
  if (p.amount <= 0n) return 'invalid_amount'
  if (policy.maxAmount !== 0n && p.amount > policy.maxAmount) return 'over_limit'
  if (policy.expiresAt && now > policy.expiresAt) return 'expired'
  // check_payment said no for a reason we can't see client-side (clock skew around expiry).
  return 'expired'
}

export { NoirContractError }
