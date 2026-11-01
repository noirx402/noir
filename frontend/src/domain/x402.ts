import { Keypair, xdr, Address, Asset, scValToNative } from '@stellar/stellar-sdk'
import { toCall, parseContractError, toHex, type NoirContracts, type NoirOperation } from '@noirx402/agent-sdk'
import { secureGetItem, secureSetItem, secureDeleteItem } from '@/services/secureStorage'
import { stellarService } from '@/services/stellar-service'
import { AppConfig } from '@/constants/config'
import { logger } from '@/lib/logger'
import { humanizeStellarError } from '@/lib/stellarErrors'
import { spendableBalance, minimumBalance, toStellarAmount } from '@/lib/stellarAccount'

const SecureStore = {
  getItemAsync: secureGetItem,
  setItemAsync: secureSetItem,
  deleteItemAsync: secureDeleteItem,
}

// ── device ownership ────────────────────────────────────────────────────────

/** On-chain ownership of a device hash, relative to the calling wallet. */
export type DeviceOwnership =
  | { status: 'free' }
  | { status: 'mine' | 'other'; owner: string; agent: string; createdAt: number | null; active: boolean }

/**
 * Thrown before funding escrow for a tag that is not registered to this wallet.
 * payment_escrow.fund_escrow accepts any device hash, but withdraw and sweep
 * resolve the owner through device_registry — so XLM sent for an unregistered
 * tag could never be recovered.
 */
export class DeviceNotLinkedError extends Error {
  constructor() {
    super('This tag is not linked to your wallet. Finish linking it before adding funds.')
    this.name = 'DeviceNotLinkedError'
  }
}

/** Thrown when a tag is already bound to a different wallet on-chain. */
export class DeviceOwnedByOtherWalletError extends Error {
  constructor(public readonly owner: string, public readonly createdAt: number | null) {
    super(`This tag is already linked to another wallet (${owner.slice(0, 4)}…${owner.slice(-4)})`)
    this.name = 'DeviceOwnedByOtherWalletError'
  }
}

/** Thrown before signing when the wallet can't cover an amount plus its reserve. */
export class InsufficientFundsError extends Error {
  constructor(public readonly requestedXlm: number, public readonly spendableXlm: number) {
    super(`Not enough XLM: ${spendableXlm.toFixed(2)} XLM available after the network reserve`)
    this.name = 'InsufficientFundsError'
  }
}

/** Parse a `device_registry.get_device` DeviceInfo result. */
function parseDeviceInfo(val: xdr.ScVal, walletPub: string): DeviceOwnership {
  const info = scValToNative(val) as { owner: string; agent: string; status: number; created_at: bigint | number }
  const created = info.created_at != null ? Number(info.created_at) : NaN
  return {
    status: info.owner === walletPub ? 'mine' : 'other',
    owner: String(info.owner),
    agent: String(info.agent),
    createdAt: Number.isFinite(created) && created > 0 ? created : null,
    active: Number(info.status) === 0,
  }
}

// ── contract calls via @noirx402/agent-sdk ──────────────────────────────────
// Argument encoding and contract error names come from the published SDK, the
// same code the Chrome extension and third-party integrations run. Signing and
// submission stay in stellarService, which carries the React Native fixes for
// stellar-sdk v16 (see frontend/AGENTS.md).

// Agents spend native XLM via its Stellar Asset Contract.
function nativeXlmSac(): string {
  const passphrase = stellarService.networkName === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015'
  return Asset.native().contractId(passphrase)
}

function contractIdOf(contract: keyof NoirContracts): string {
  const id = {
    deviceRegistry: AppConfig.stellar.deviceRegistryContract,
    agentRegistry: AppConfig.stellar.agentRegistryContract,
    paymentEscrow: AppConfig.stellar.paymentEscrowContract,
  }[contract]
  if (!id) throw new Error(`${contract} contract not configured`)
  return id
}

/** `op` as a stellarService call: contract id, method and SDK-encoded args. */
function sdkCall(source: string, op: NoirOperation): { contractId: string; method: string; args: xdr.ScVal[] } {
  const { contract, method, args } = toCall(source, op)
  return { contractId: contractIdOf(contract), method, args }
}

/** The contract's own error name for `err` (e.g. 'AlreadyRegistered'), or null. */
function contractErrorName(contract: keyof NoirContracts, err: unknown): string | null {
  const msg = (err as any)?.message ?? String(err ?? '')
  return parseContractError(contract, '', msg)?.errorName ?? null
}

/** The contract stores expiry as unix seconds (0 = never); the SDK takes a Date or null. */
const expiryDate = (expiresAt: bigint): Date | null => (expiresAt === 0n ? null : new Date(Number(expiresAt) * 1000))

/** Constrained delegation policy, in contract units. */
export interface AgentPolicyInput {
  /** Per-payment cap in stroops. 0n = uncapped. */
  maxAmountStroops: bigint
  /** Unix seconds after which the agent can no longer pay. 0n = never. */
  expiresAt: bigint
}

/**
 * Turn UI choices (XLM cap, expiry in days) into contract-ready policy values.
 * Mirrors register_agent's own validation so the user never signs a tx that
 * is guaranteed to fail with InvalidPolicy.
 */
/**
 * Default agent policy applied when a card is linked: a per-payment cap of
 * 100,000 XLM and no expiry — the agent works until the card is revoked.
 * Not shown in the link flow (it's on by default).
 */
export const DEFAULT_AGENT_CAP_XLM = 100_000

export function buildAgentPolicy(opts: {
  maxAmountXlm?: number
  expiryDays?: number
  nowSec?: number
}): AgentPolicyInput {
  const max = opts.maxAmountXlm ?? 0
  const days = opts.expiryDays ?? 0
  if (!Number.isFinite(max) || max < 0) throw new Error('Spending limit must be zero or positive')
  if (!Number.isFinite(days) || days < 0) throw new Error('Expiry must be zero or positive days')
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  return {
    maxAmountStroops: BigInt(Math.round(max * 10_000_000)),
    expiresAt: days === 0 ? 0n : BigInt(now + Math.round(days * 86_400)),
  }
}

// The policy chosen at provisioning is kept per device so an automatic
// re-registration (e.g. after a contract redeploy) restores the user's own
// limits instead of silently widening them to "uncapped, never expires".
const policyKey = (deviceHashHex: string) => `x402.policy.${deviceHashHex}`

async function savePolicy(deviceHashHex: string, policy: AgentPolicyInput): Promise<void> {
  await SecureStore.setItemAsync(policyKey(deviceHashHex), JSON.stringify({
    maxAmountStroops: policy.maxAmountStroops.toString(),
    expiresAt: policy.expiresAt.toString(),
  }))
}

async function loadSavedPolicy(deviceHashHex: string): Promise<AgentPolicyInput | null> {
  const raw = await SecureStore.getItemAsync(policyKey(deviceHashHex))
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    return { maxAmountStroops: BigInt(p.maxAmountStroops), expiresAt: BigInt(p.expiresAt) }
  } catch {
    return null
  }
}

/** Where a device's agent stands on agent_registry, relative to the local agent key. */
export type AgentChainStatus =
  | 'active'      // registered for this agent key and not expired
  | 'missing'     // no policy on-chain (never registered, revoked, or contracts redeployed)
  | 'expired'     // registered for this agent key but past expires_at
  | 'mismatch'    // registered for a different agent key

export interface AgentSyncResult {
  deviceUidHash: string
  before: AgentChainStatus | 'unknown'
  outcome: 'ok' | 'registered' | 'skipped' | 'failed'
  reason?: string
}

/** On-chain AgentPolicy as read back from agent_registry.get_policy. */
export interface OnChainAgentPolicy {
  agent: string
  maxAmountStroops: bigint
  asset: string
  expiresAt: bigint
}

// ── Per-agent SecureStore keys ──────────────────────────────────────────────
// Each agent is namespaced by its HD index, so multiple agents coexist without
// clobbering one another (the previous single-agent cache was the source of the
// stale-key bugs). The set of live agent indexes lives in AGENTS_INDEX_KEY.
const AGENTS_INDEX_KEY = 'x402.agents.index'
const legacySecretKey = (i: number) => `x402.agent.${i}.secret`
const legacyPublicKey = (i: number) => `x402.agent.${i}.public`
const legacyBudgetKey = (i: number) => `x402.agent.${i}.budget`
const legacyCreatedKey = (i: number) => `x402.agent.${i}.created`
const legacyLabelKey = (i: number) => `x402.agent.${i}.label`
const legacyDeviceKey = (i: number) => `x402.agent.${i}.device`

// Legacy single-agent keys (pre-multi-agent). Migrated into index 1 on first use.
const OLD_SECRET_KEY = 'x402.agent.secret'
const OLD_PUBLIC_KEY = 'x402.agent.public'
const OLD_BUDGET_KEY = 'x402.agent.budget'
const OLD_CREATED_KEY = 'x402.agent.created'

const LEGACY_AGENT_INDEX = 1
const DEFAULT_BUDGET_XLM = 500
const DEFAULT_BUDGET_STROOPS = DEFAULT_BUDGET_XLM * 10_000_000

export interface AgentWallet {
  index: number
  publicKey: string
  label: string
  deviceHash?: string
  balanceStroops: number
  spendingBudgetStroops: number
  totalSpentStroops: number
  isActive: boolean
  createdAt: string
}

function addressScVal(addr: string): xdr.ScVal {
  return Address.fromString(addr).toScVal()
}

// Shared in-flight listAgents() promise — see listAgents() for why.
let listAgentsInFlight: Promise<AgentWallet[]> | null = null

async function readIndexes(): Promise<number[]> {
  const raw = await SecureStore.getItemAsync(AGENTS_INDEX_KEY)
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((n) => Number.isInteger(n)) : []
  } catch {
    return []
  }
}

async function writeIndexes(indexes: number[]): Promise<void> {
  const unique = Array.from(new Set(indexes)).sort((a, b) => a - b)
  await SecureStore.setItemAsync(AGENTS_INDEX_KEY, JSON.stringify(unique))
}

async function addIndex(index: number): Promise<void> {
  const idx = await readIndexes()
  if (!idx.includes(index)) await writeIndexes([...idx, index])
}

async function removeIndex(index: number): Promise<void> {
  const idx = await readIndexes()
  await writeIndexes(idx.filter((i) => i !== index))
}

/**
 * Migrate the pre-multi-agent single agent into agent index 1. Idempotent.
 *
 * IMPORTANT: this migrates ONLY a genuine legacy agent, identified by the old
 * flat SecureStore keys (`x402.agent.secret` / `x402.agent.public`) that the
 * single-agent build wrote. It must NOT fall back to the wallet's HD-derived
 * `agentSecret`/`agentPublic`: `deriveKeys()` populates those for EVERY wallet,
 * so using them here would auto-materialize a phantom "Agent 1" on every fresh
 * wallet — even when the user has linked no devices and created no agents.
 * Agents now come into existence only when the user links a device
 * (`createAgent` / `registerDeviceAndAgentOnChain`) or when
 * `syncAgentsFromDevices` rebuilds them from real on-chain devices.
 */
async function ensureLegacyAgentMigrated(): Promise<void> {
  const already = await SecureStore.getItemAsync(legacySecretKey(LEGACY_AGENT_INDEX))
  if (already) return

  // Only migrate from the old single-agent flat cache. Absence of these keys
  // means there is no legacy agent to preserve — a brand-new wallet lands here.
  const secret = await SecureStore.getItemAsync(OLD_SECRET_KEY)
  const publicKey =
    (await SecureStore.getItemAsync(OLD_PUBLIC_KEY)) ||
    (secret ? Keypair.fromSecret(secret).publicKey() : null)
  if (!secret || !publicKey) return

  // If a retired marker exists for index 1, do not resurrect it.
  const { walletService } = await import('@/services/wallet')
  if (await walletService.isAgentIndexRetired(LEGACY_AGENT_INDEX)) return

  const budget = (await SecureStore.getItemAsync(OLD_BUDGET_KEY)) ?? String(DEFAULT_BUDGET_STROOPS)
  const created = (await SecureStore.getItemAsync(OLD_CREATED_KEY)) ?? new Date().toISOString()

  await SecureStore.setItemAsync(legacySecretKey(LEGACY_AGENT_INDEX), secret)
  await SecureStore.setItemAsync(legacyPublicKey(LEGACY_AGENT_INDEX), publicKey)
  await SecureStore.setItemAsync(legacyBudgetKey(LEGACY_AGENT_INDEX), budget)
  await SecureStore.setItemAsync(legacyCreatedKey(LEGACY_AGENT_INDEX), created)
  await SecureStore.setItemAsync(legacyLabelKey(LEGACY_AGENT_INDEX), 'Agent 1')
  await addIndex(LEGACY_AGENT_INDEX)
}

async function loadAgentMeta(index: number): Promise<AgentWallet | null> {
  const secret = await SecureStore.getItemAsync(legacySecretKey(index))
  if (!secret) return null
  const publicKey = (await SecureStore.getItemAsync(legacyPublicKey(index))) || Keypair.fromSecret(secret).publicKey()
  const budgetRaw = await SecureStore.getItemAsync(legacyBudgetKey(index))
  const created = (await SecureStore.getItemAsync(legacyCreatedKey(index))) || new Date().toISOString()
  const label = (await SecureStore.getItemAsync(legacyLabelKey(index))) || `Agent ${index}`
  const deviceHash = (await SecureStore.getItemAsync(legacyDeviceKey(index))) || undefined

  const remainingBudget = budgetRaw ? parseInt(budgetRaw, 10) : DEFAULT_BUDGET_STROOPS
  const totalSpent = Math.max(0, DEFAULT_BUDGET_STROOPS - remainingBudget)

  let balanceStroops = 0
  try {
    const onChain = await stellarService.getBalance(publicKey)
    balanceStroops = Math.floor(onChain.xlm * 10_000_000)
  } catch { /* non-critical */ }

  return {
    index,
    publicKey,
    label,
    deviceHash,
    balanceStroops,
    spendingBudgetStroops: DEFAULT_BUDGET_STROOPS,
    totalSpentStroops: totalSpent,
    isActive: true,
    createdAt: created,
  }
}

export const x402 = {
  /**
   * Create a NEW agent by allocating the next HD index from the wallet,
   * deriving its keypair, and persisting per-agent metadata. Each agent starts
   * with a zero balance — the owner tops it up from their own wallet.
   * Returns the created agent. Pass a label and (optionally) the device hash it
   * is being linked to.
   */
  async createAgent(opts?: { label?: string; deviceHash?: string }): Promise<AgentWallet> {
    const { walletService } = await import('@/services/wallet')
    const derived = await walletService.allocateAgentIndex()

    await SecureStore.setItemAsync(legacySecretKey(derived.index), derived.secret)
    await SecureStore.setItemAsync(legacyPublicKey(derived.index), derived.public)
    await SecureStore.setItemAsync(legacyBudgetKey(derived.index), String(DEFAULT_BUDGET_STROOPS))
    const created = new Date().toISOString()
    await SecureStore.setItemAsync(legacyCreatedKey(derived.index), created)
    await SecureStore.setItemAsync(legacyLabelKey(derived.index), opts?.label ?? `Agent ${derived.index}`)
    if (opts?.deviceHash) await SecureStore.setItemAsync(legacyDeviceKey(derived.index), opts.deviceHash)
    await addIndex(derived.index)

    return {
      index: derived.index,
      publicKey: derived.public,
      label: opts?.label ?? `Agent ${derived.index}`,
      deviceHash: opts?.deviceHash,
      balanceStroops: 0,
      spendingBudgetStroops: DEFAULT_BUDGET_STROOPS,
      totalSpentStroops: 0,
      isActive: true,
      createdAt: created,
    }
  },

  /**
   * List all live agents (excludes permanently retired ones). Per-agent
   * balance fetches run in parallel instead of sequentially — with several
   * agents this used to serialize one Horizon round-trip per agent.
   *
   * If a call comes in while a previous one is still in flight (the common
   * case: syncAgentsFromDevices() calls this internally and the caller then
   * immediately calls it again), it's handed the same in-flight promise
   * instead of starting a second full fetch pass.
   */
  async listAgents(): Promise<AgentWallet[]> {
    if (listAgentsInFlight) return listAgentsInFlight
    listAgentsInFlight = (async () => {
      try {
        await ensureLegacyAgentMigrated()
        const indexes = await readIndexes()
        const loaded = await Promise.all(indexes.map((i) => loadAgentMeta(i)))
        const agents = loaded.filter((a): a is AgentWallet => a != null)
        return agents.sort((a, b) => a.index - b.index)
      } finally {
        listAgentsInFlight = null
      }
    })()
    return listAgentsInFlight
  },

  /**
   * Reconstruct/self-heal agents from the persisted device list. Fixes the
   * "no agents after login" case: the device list survives login (Zustand
   * persistence), but per-agent SecureStore metadata may be missing on a fresh
   * device or after a cache-bust. For each device with an on-chain agent pubkey
   * that has no local agent, re-derive the HD index that matches the pubkey and
   * materialize it locally.
   *
   * `devices` come from the app store; each has { deviceUidHash, agentPublicKey,
   * label, createdAt }. Deterministic HD derivation means the same mnemonic +
   * index always reproduces the agent keypair, so we can rebuild without any
   * secret ever leaving the device.
   *
   * Retired indexes are skipped. Scans up to `maxScan` indexes.
   */
  async syncAgentsFromDevices(
    devices: { deviceUidHash: string; agentPublicKey?: string; label?: string; createdAt?: string }[],
    maxScan = 64,
  ): Promise<number> {
    const { walletService } = await import('@/services/wallet')
    const keys = await walletService.loadKeys()
    if (!keys?.mnemonic) return 0

    await ensureLegacyAgentMigrated()

    // Which pubkeys do we already have materialized locally?
    const existing = await this.listAgents()
    const knownPubkeys = new Set(existing.map((a) => a.publicKey))

    // Nothing to heal: every device with an on-chain agent pubkey already has
    // a local agent for it. Skip the (expensive, up-to-64-iteration) HD
    // derivation scan below entirely — this is the common case on every
    // normal screen load, not just the fresh-login healing case.
    const needsHealing = devices.some((d) => d.agentPublicKey && !knownPubkeys.has(d.agentPublicKey))
    if (!needsHealing) return 0

    // Precompute derived pubkey -> index for the scan range (skip retired).
    const retired = new Set(keys.retiredAgentIndexes ?? [])
    const derivedByPubkey = new Map<string, number>()
    for (let i = 1; i <= maxScan; i++) {
      if (retired.has(i)) continue
      try {
        const d = walletService.deriveAgentAt(keys.mnemonic, i)
        derivedByPubkey.set(d.public, i)
      } catch { /* skip */ }
    }

    let healed = 0
    let highestIndex = (keys.agentIndexNext ?? 2) - 1
    for (const device of devices) {
      const pub = device.agentPublicKey
      if (!pub || knownPubkeys.has(pub)) continue

      const index = derivedByPubkey.get(pub)
      if (index == null) continue // agent for this device isn't from our seed (or beyond scan range)
      if (retired.has(index)) continue

      const derived = walletService.deriveAgentAt(keys.mnemonic, index)
      await SecureStore.setItemAsync(legacySecretKey(index), derived.secret)
      await SecureStore.setItemAsync(legacyPublicKey(index), derived.public)
      const budgetExists = await SecureStore.getItemAsync(legacyBudgetKey(index))
      if (!budgetExists) await SecureStore.setItemAsync(legacyBudgetKey(index), String(DEFAULT_BUDGET_STROOPS))
      await SecureStore.setItemAsync(legacyCreatedKey(index), device.createdAt || new Date().toISOString())
      await SecureStore.setItemAsync(legacyLabelKey(index), device.label || `Agent ${index}`)
      await SecureStore.setItemAsync(legacyDeviceKey(index), device.deviceUidHash)
      await addIndex(index)
      knownPubkeys.add(pub)
      if (index > highestIndex) highestIndex = index
      healed++
    }

    // Keep the allocation counter ahead of any reconstructed index.
    if (healed > 0 && (keys.agentIndexNext ?? 2) <= highestIndex) {
      await walletService.saveKeys({ ...keys, agentIndexNext: highestIndex + 1 })
    }

    return healed
  },

  /** Resolve the agent index linked to a device hash, if any. */
  async getAgentIndexForDevice(deviceHash: string): Promise<number | null> {
    const indexes = await readIndexes()
    for (const i of indexes) {
      const dev = await SecureStore.getItemAsync(legacyDeviceKey(i))
      if (dev === deviceHash) return i
    }
    return null
  },

  /**
   * Find the agent index for a card using only data on this phone — no
   * network reads, so it is instant. Order: the stored device link, then the
   * stored public key of each agent, then an HD re-derivation from the seed.
   * A match found by key is re-linked to the card so the next lookup is the
   * fast path. Returns null when the card's agent was not made on this phone;
   * callers must never fall back to agent 1 (that would pay from the wrong card).
   */
  async resolveAgentIndex(deviceHash: string, agentPublicKey?: string | null): Promise<number | null> {
    const linked = await this.getAgentIndexForDevice(deviceHash)
    if (linked != null) return linked
    if (!agentPublicKey) return null

    const indexes = await readIndexes()
    for (const i of indexes) {
      const secret = await SecureStore.getItemAsync(legacySecretKey(i))
      if (!secret) continue
      const pub = (await SecureStore.getItemAsync(legacyPublicKey(i))) || Keypair.fromSecret(secret).publicKey()
      if (pub === agentPublicKey) {
        await this.linkAgentToDevice(i, deviceHash)
        return i
      }
    }

    // Keys missing locally (fresh restore): rebuild them from the seed.
    const healed = await this.syncAgentsFromDevices([{ deviceUidHash: deviceHash, agentPublicKey }])
    return healed > 0 ? this.getAgentIndexForDevice(deviceHash) : null
  },

  /** Link an existing agent index to a device hash. */
  async linkAgentToDevice(index: number, deviceHash: string): Promise<void> {
    await SecureStore.setItemAsync(legacyDeviceKey(index), deviceHash)
  },

  /** Get a single agent's metadata + on-chain balance. Defaults to legacy agent 1. */
  async getAgent(index: number = LEGACY_AGENT_INDEX): Promise<AgentWallet | null> {
    await ensureLegacyAgentMigrated()
    return loadAgentMeta(index)
  },

  /** Secret for a given agent index (defaults to legacy agent 1). */
  async getAgentSecret(index: number = LEGACY_AGENT_INDEX): Promise<string | null> {
    await ensureLegacyAgentMigrated()
    return SecureStore.getItemAsync(legacySecretKey(index))
  },

  /** True if at least one agent exists. */
  async hasAgent(): Promise<boolean> {
    await ensureLegacyAgentMigrated()
    return (await readIndexes()).length > 0
  },

  /**
   * Wipe ALL local agent keys/metadata (used on account deletion / wallet
   * reset). Does NOT retire HD indexes — a fresh wallet restore re-derives
   * from the mnemonic. Retirement is reserved for explicit per-agent revoke.
   */
  async clearAllAgents(): Promise<void> {
    const indexes = await readIndexes()
    for (const i of indexes) {
      await SecureStore.deleteItemAsync(legacySecretKey(i))
      await SecureStore.deleteItemAsync(legacyPublicKey(i))
      await SecureStore.deleteItemAsync(legacyBudgetKey(i))
      await SecureStore.deleteItemAsync(legacyCreatedKey(i))
      await SecureStore.deleteItemAsync(legacyLabelKey(i))
      await SecureStore.deleteItemAsync(legacyDeviceKey(i))
    }
    await SecureStore.deleteItemAsync(AGENTS_INDEX_KEY)
    // Also clear any lingering pre-migration flat keys.
    await SecureStore.deleteItemAsync(OLD_SECRET_KEY)
    await SecureStore.deleteItemAsync(OLD_PUBLIC_KEY)
    await SecureStore.deleteItemAsync(OLD_BUDGET_KEY)
    await SecureStore.deleteItemAsync(OLD_CREATED_KEY)
  },

  async getAgentBalanceXlm(index: number = LEGACY_AGENT_INDEX): Promise<number> {
    const secret = await SecureStore.getItemAsync(legacySecretKey(index))
    if (!secret) return 0
    const kp = Keypair.fromSecret(secret)
    const bal = await stellarService.getBalance(kp.publicKey())
    return bal.xlm
  },

  /**
   * Pay from a specific agent, enforcing that agent's own spending budget
   * BEFORE submitting. Budgets are per-agent, so cards are isolated.
   */
  async payWithAgent(params: {
    agentIndex?: number
    destination: string
    amount: string
    assetCode?: string
    assetIssuer?: string
  }): Promise<{ hash: string } | { error: string }> {
    const index = params.agentIndex ?? LEGACY_AGENT_INDEX
    const secret = await SecureStore.getItemAsync(legacySecretKey(index))
    if (!secret) return { error: 'No agent wallet' }

    const agentPub = Keypair.fromSecret(secret).publicKey()
    // One Horizon read tells us both "does it exist" and "can it cover this".
    // accountExists() reports a timeout as "missing", which blamed an empty
    // card for what was really a slow network.
    let bal: { xlm: number; subentryCount?: number }
    try {
      bal = await stellarService.getBalanceStrict(agentPub)
    } catch (e: any) {
      return { error: humanizeStellarError(e) }
    }
    if (bal.xlm <= 0) {
      return { error: 'This card has no balance yet — open the card and tap Top up.' }
    }
    const available = spendableBalance(bal.xlm, bal.subentryCount ?? 0)
    if (parseFloat(params.amount) > available) {
      return { error: `This card only has ${Math.max(0, available).toFixed(2)} XLM to spend — open the card and tap Top up.` }
    }

    const cost = Math.ceil(parseFloat(params.amount) * 10_000_000)
    const budgetRaw = await SecureStore.getItemAsync(legacyBudgetKey(index))
    const budget = budgetRaw ? parseInt(budgetRaw, 10) : DEFAULT_BUDGET_STROOPS
    if (cost > budget) {
      return { error: `Agent spending budget exhausted — ${(budget / 10_000_000).toFixed(2)} XLM remaining` }
    }

    const { agentIndex, ...paymentParams } = params
    const result = await stellarService.submitPayment({
      sourceSecret: secret,
      ...paymentParams,
    })

    if ('hash' in result) {
      await SecureStore.setItemAsync(legacyBudgetKey(index), String(budget - cost))
    }
    return result
  },

  /**
   * Top up a specific agent from the owner's wallet. Creates the agent's
   * on-chain account if it does not exist yet.
   */
  async topUpAgent(amountXlm: number, fromSecret: string, index: number = LEGACY_AGENT_INDEX): Promise<string> {
    const secret = await SecureStore.getItemAsync(legacySecretKey(index))
    if (!secret) throw new Error('No agent wallet configured')
    const agentPub = Keypair.fromSecret(secret).publicKey()

    const exists = await stellarService.accountExists(agentPub)
    if (!exists) {
      const created = await stellarService.submitCreateAccount({
        sourceSecret: fromSecret,
        destination: agentPub,
        amount: amountXlm.toFixed(7),
      })
      if ('error' in created) throw new Error(created.error)
      return created.hash
    }

    const result = await stellarService.submitPayment({
      sourceSecret: fromSecret,
      destination: agentPub,
      amount: amountXlm.toFixed(7),
      assetCode: 'XLM',
    })
    if ('error' in result) throw new Error(result.error)
    return result.hash
  },

  /**
   * Sweep a specific agent's recoverable on-chain XLM balance back to the
   * destination (the owner). Used during revocation.
   *
   * A Stellar account can never spend below its MINIMUM BALANCE, which is
   * `(2 + subentry_count) * base_reserve` (base reserve = 0.5 XLM). Sending
   * more than `balance - minimum - fee` is rejected with `op_underfunded`, so
   * the sweep must leave the reserve (plus a small fee buffer) behind. The
   * reserve stays locked in the agent account — which is fine: retire does not
   * merge/delete the account, it just stops the app from using it.
   */
  async sweepAgentFunds(destination: string, index: number = LEGACY_AGENT_INDEX): Promise<{ hash: string } | { error: string }> {
    const secret = await SecureStore.getItemAsync(legacySecretKey(index))
    if (!secret) return { error: 'No agent wallet' }

    const agentPub = Keypair.fromSecret(secret).publicKey()
    const exists = await stellarService.accountExists(agentPub)
    if (!exists) return { error: 'Agent wallet is empty — nothing to recover' }

    const bal = await stellarService.getBalance(agentPub)

    // A Stellar account can never spend below its minimum balance. Use the
    // shared account rules so the reserve math lives in one place, and hold
    // back a comfortable fee cushion so the sweep never hits op_underfunded.
    const FEE_BUFFER_XLM = 0.01
    const sweepable = spendableBalance(bal.xlm, bal.subentryCount ?? 0, FEE_BUFFER_XLM)
    if (sweepable <= 0) {
      logger.debug(
        `[x402] agent ${agentPub} below reserve: xlm=${bal.xlm} min=${minimumBalance(bal.subentryCount ?? 0)}`,
      )
      return { error: 'Agent wallet has no recoverable funds above the reserve' }
    }

    return stellarService.submitPayment({
      sourceSecret: secret,
      destination,
      amount: toStellarAmount(sweepable),
      assetCode: 'XLM',
    })
  },

  /**
   * PERMANENTLY revoke an agent. Sweeps all XLM back to the owner, then wipes
   * the agent's local keys and retires its HD index so it can NEVER be
   * re-derived or recovered. On-chain agent/device revocation is handled by the
   * caller (revokeAgentOnChain / revokeDeviceOnChain) since it needs the
   * device hash and wallet secret.
   *
   * Returns the sweep result so the caller can surface the recovery tx hash.
   */
  async retireAgent(index: number, ownerAddress: string): Promise<{ hash: string } | { error: string } | { skipped: true }> {
    const secret = await SecureStore.getItemAsync(legacySecretKey(index))
    if (!secret) {
      // Nothing to sweep, but still ensure the index is retired.
      const { walletService } = await import('@/services/wallet')
      await walletService.retireAgentIndex(index)
      return { skipped: true }
    }

    let sweep: { hash: string } | { error: string } | { skipped: true } = { skipped: true }
    try {
      const result = await this.sweepAgentFunds(ownerAddress, index)
      sweep = result
    } catch (e: any) {
      logger.warn(`[x402] sweep during retire failed: ${e?.message ?? e}`)
      sweep = { error: e?.message ?? 'sweep failed' }
    }

    // Wipe local keys/metadata.
    await SecureStore.deleteItemAsync(legacySecretKey(index))
    await SecureStore.deleteItemAsync(legacyPublicKey(index))
    await SecureStore.deleteItemAsync(legacyBudgetKey(index))
    await SecureStore.deleteItemAsync(legacyCreatedKey(index))
    await SecureStore.deleteItemAsync(legacyLabelKey(index))
    await SecureStore.deleteItemAsync(legacyDeviceKey(index))
    await removeIndex(index)

    // Permanently retire the HD index — never reused, never recoverable.
    const { walletService } = await import('@/services/wallet')
    await walletService.retireAgentIndex(index)

    return sweep
  },

  // ── device_registry contract ──

  async registerDeviceAndAgentOnChain(params: {
    walletSecret: string
    deviceHashHex: string
    agentPublicKey: string
    /** Constrained delegation policy. Omitted → uncapped, never expires. */
    policy?: AgentPolicyInput
  }): Promise<void> {
    const contractIdDevice = AppConfig.stellar.deviceRegistryContract
    const contractIdAgent = AppConfig.stellar.agentRegistryContract
    if (!contractIdDevice) throw new Error('deviceRegistryContract not configured')
    if (!contractIdAgent) throw new Error('agentRegistryContract not configured')

    // Error codes differ per contract, so match the SDK's per-contract names:
    // agent_registry #4 is InvalidPolicy, which must surface, not be swallowed
    // as "already done".
    const deviceAlreadyRegistered = (e: any) =>
      ['AlreadyRegistered', 'NotOwner'].includes(contractErrorName('deviceRegistry', e) ?? '') || (e?.message ?? '').includes('AlreadyRegistered')
    const agentAlreadyRegistered = (e: any) =>
      contractErrorName('agentRegistry', e) === 'AlreadyRegistered' || (e?.message ?? '').includes('AlreadyRegistered')

    const kp = Keypair.fromSecret(params.walletSecret)
    const pub = kp.publicKey()
    const account = await stellarService.loadSourceAccount(pub)

    const deviceHashScVal = stellarService.deviceHashScVal(params.deviceHashHex)
    const agentScVal = stellarService.walletAddressScVal(params.agentPublicKey)

    // These two reads are independent of each other — run them concurrently
    // instead of waiting on get_device before even starting is_auth.
    const [deviceCheck, agentCheck] = await Promise.all([
      stellarService.readContract({
        contractId: contractIdDevice,
        method: 'get_device',
        args: [deviceHashScVal],
        source: pub,
      }).then(
        (info) => ({ ok: true as const, info }),
        (e: any) => ({ ok: false as const, error: e }),
      ),
      stellarService.readContract({
        contractId: contractIdAgent,
        method: 'is_auth',
        args: [deviceHashScVal, agentScVal],
        source: pub,
      }).then(
        (auth) => ({ ok: true as const, auth }),
        (e: any) => ({ ok: false as const, error: e }),
      ),
    ])

    let deviceRegistered = false
    if (deviceCheck.ok) {
      deviceRegistered = true
      // A tag owned by another wallet must not be treated as "already done":
      // register / register_agent would fail with AlreadyRegistered and the
      // caller would wrongly report success while this wallet's agent is
      // never authorized.
      let ownership: DeviceOwnership | null = null
      try { ownership = parseDeviceInfo(deviceCheck.info, pub) } catch { /* unparseable → fall through */ }
      if (ownership && ownership.status === 'other') {
        throw new DeviceOwnedByOtherWalletError(ownership.owner, ownership.createdAt)
      }
    } else {
      const e = deviceCheck.error
      const msg = e?.message ?? ''
      if (contractErrorName('deviceRegistry', e) !== 'DeviceNotFound' && !msg.includes('DeviceNotFound')) {
        logger.debug(`[x402] device pre-check failed (falling back to write): ${msg}`)
      }
    }

    let agentRegistered = false
    if (agentCheck.ok) {
      agentRegistered = agentCheck.auth.b() === true
    } else {
      logger.debug(`[x402] agent pre-check failed (falling back to write): ${agentCheck.error?.message ?? agentCheck.error}`)
    }

    let registerSubmitted = false
    if (!deviceRegistered) {
      try {
        // Wait for finality: callers read ownership / fund escrow right after,
        // and a submitted-but-unconfirmed register still reads as "free".
        await stellarService.invokeContractAndWait({
          ...sdkCall(pub, { kind: 'registerDevice', deviceHash: params.deviceHashHex, agent: params.agentPublicKey }),
          signerSecret: params.walletSecret,
          sourceAccount: account,
        })
        registerSubmitted = true
      } catch (e: any) {
        if (!deviceAlreadyRegistered(e)) throw e
      }
    }

    // NOTE: do NOT manually increment here. invokeContract builds the tx with
    // `TransactionBuilder(account, ...)`, and TransactionBuilder.build()
    // already calls account.incrementSequenceNumber() internally (see
    // @stellar/stellar-base transaction_builder.js). Incrementing again would
    // leave a one-slot gap, so register_agent would submit with seq N+3 while
    // the account is only at N+1 on-chain → txBAD_SEQ, which Soroban RPC
    // surfaces as `sendTransaction status=ERROR, errorResultXdr=undefined`.
    void registerSubmitted

    // Remember an explicitly chosen policy so later automatic re-registration
    // reuses it; without one, fall back to what was saved at provisioning.
    if (params.policy) await savePolicy(params.deviceHashHex, params.policy)

    if (!agentRegistered) {
      const policy = params.policy ?? (await loadSavedPolicy(params.deviceHashHex))
      const { maxAmountStroops, expiresAt } = policy ?? { maxAmountStroops: 0n, expiresAt: 0n }
      try {
        await stellarService.invokeContractAndWait({
          ...sdkCall(pub, {
            kind: 'registerAgent', deviceHash: params.deviceHashHex, agent: params.agentPublicKey,
            asset: nativeXlmSac(), maxAmount: maxAmountStroops, expiresAt: expiryDate(expiresAt),
          }),
          signerSecret: params.walletSecret,
          sourceAccount: account,
        })
      } catch (e: any) {
        if (!agentAlreadyRegistered(e)) throw e
      }
    }
  },

  /** Read agent_registry for one device and classify it against the local agent key. */
  async getAgentChainStatus(deviceHashHex: string, agentPublicKey: string, source: string): Promise<AgentChainStatus> {
    const policy = await this.getAgentPolicy(deviceHashHex, source)
    if (!policy) return 'missing'
    if (policy.agent !== agentPublicKey) return 'mismatch'
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (policy.expiresAt !== 0n && now > policy.expiresAt) return 'expired'
    return 'active'
  },

  /**
   * Make sure every linked device has its agent registered on agent_registry,
   * registering any that are missing (e.g. after a contract redeploy, or a
   * provisioning run that stopped between `register` and `register_agent`).
   *
   * Only a *missing* registration is repaired, and only for a device this
   * wallet still owns and has not revoked. Expired or mismatched agents are
   * reported, never overwritten — replacing a live policy is the user's call.
   * Devices are processed one at a time because each write uses the wallet's
   * account sequence.
   */
  async syncAgentRegistrations(params: {
    walletSecret: string
    devices: { deviceUidHash: string; agentPublicKey?: string }[]
  }): Promise<AgentSyncResult[]> {
    const pub = Keypair.fromSecret(params.walletSecret).publicKey()
    const results: AgentSyncResult[] = []

    for (const d of params.devices) {
      const hash = d.deviceUidHash
      if (!d.agentPublicKey) {
        results.push({ deviceUidHash: hash, before: 'unknown', outcome: 'skipped', reason: 'no local agent key' })
        continue
      }
      let before: AgentChainStatus
      try {
        before = await this.getAgentChainStatus(hash, d.agentPublicKey, pub)
      } catch (e: any) {
        results.push({ deviceUidHash: hash, before: 'unknown', outcome: 'failed', reason: e?.message })
        continue
      }
      if (before !== 'missing') {
        results.push({ deviceUidHash: hash, before, outcome: before === 'active' ? 'ok' : 'skipped' })
        continue
      }

      try {
        // A device absent from device_registry may have been unlinked on another
        // phone — re-linking it is a user action, not something to do silently.
        const ownership = await this.getDeviceOwnership(hash, pub)
        if (ownership.status !== 'mine' || !ownership.active) {
          const why = ownership.status === 'free' ? 'device not registered on-chain'
            : ownership.status === 'other' ? 'device owned by another wallet' : 'device revoked'
          results.push({ deviceUidHash: hash, before, outcome: 'skipped', reason: why })
          continue
        }
        const saved = await loadSavedPolicy(hash)
        if (saved && saved.expiresAt !== 0n && BigInt(Math.floor(Date.now() / 1000)) >= saved.expiresAt) {
          // Re-registering would be rejected as InvalidPolicy; the user must pick a new expiry.
          results.push({ deviceUidHash: hash, before, outcome: 'skipped', reason: 'saved policy has expired' })
          continue
        }
        await this.registerDeviceAndAgentOnChain({
          walletSecret: params.walletSecret,
          deviceHashHex: hash,
          agentPublicKey: d.agentPublicKey,
        })
        results.push({ deviceUidHash: hash, before, outcome: 'registered' })
      } catch (e: any) {
        results.push({ deviceUidHash: hash, before, outcome: 'failed', reason: e?.message })
      }
    }
    return results
  },

  /**
   * Look up who owns `deviceHashHex` on-chain, relative to `walletPub`.
   * Returns `{ status: 'free' }` when the device is not registered.
   */
  async getDeviceOwnership(deviceHashHex: string, walletPub: string): Promise<DeviceOwnership> {
    const contractId = AppConfig.stellar.deviceRegistryContract
    if (!contractId) throw new Error('deviceRegistryContract not configured')
    try {
      const val = await stellarService.readContract({
        contractId,
        method: 'get_device',
        args: [stellarService.deviceHashScVal(deviceHashHex)],
        source: walletPub,
      })
      return parseDeviceInfo(val, walletPub)
    } catch (e: any) {
      const msg = e?.message ?? ''
      if (contractErrorName('deviceRegistry', e) === 'DeviceNotFound' || msg.includes('DeviceNotFound')) return { status: 'free' }
      throw e
    }
  },

  async registerDeviceOnChain(params: {
    walletSecret: string
    deviceHashHex: string
    agentPublicKey: string
  }): Promise<string> {
    const pub = Keypair.fromSecret(params.walletSecret).publicKey()
    return stellarService.invokeContract({
      ...sdkCall(pub, { kind: 'registerDevice', deviceHash: params.deviceHashHex, agent: params.agentPublicKey }),
      signerSecret: params.walletSecret,
    })
  },

  async revokeDeviceOnChain(params: {
    walletSecret: string
    deviceHashHex: string
  }): Promise<string> {
    const pub = Keypair.fromSecret(params.walletSecret).publicKey()
    return stellarService.invokeContract({
      ...sdkCall(pub, { kind: 'revokeDevice', deviceHash: params.deviceHashHex }),
      signerSecret: params.walletSecret,
    })
  },

  // ── agent_registry contract ──

  /** Registers with the uncapped, never-expiring policy (max_amount 0, expires_at 0). */
  async registerAgentOnChain(params: {
    walletSecret: string
    deviceHashHex: string
    agentPublicKey: string
  }): Promise<string> {
    const pub = Keypair.fromSecret(params.walletSecret).publicKey()
    return stellarService.invokeContract({
      ...sdkCall(pub, {
        kind: 'registerAgent', deviceHash: params.deviceHashHex, agent: params.agentPublicKey,
        asset: nativeXlmSac(), maxAmount: 0n, expiresAt: null,
      }),
      signerSecret: params.walletSecret,
    })
  },

  async revokeAgentOnChain(params: {
    walletSecret: string
    deviceHashHex: string
  }): Promise<string> {
    const pub = Keypair.fromSecret(params.walletSecret).publicKey()
    return stellarService.invokeContract({
      ...sdkCall(pub, { kind: 'revokeAgent', deviceHash: params.deviceHashHex }),
      signerSecret: params.walletSecret,
    })
  },

  // ── payment_escrow ──

  /**
   * Fund escrow for a device using native XLM. The owner tops up the device's
   * escrow balance from their own wallet. The agent can then authorize payments
   * up to this balance (subject to its policy constraints).
   */
  async fundEscrow(params: {
    walletSecret: string
    deviceHashHex: string
    amountXlm: number
  }): Promise<string> {
    const contractId = AppConfig.stellar.paymentEscrowContract
    if (!contractId) throw new Error('paymentEscrowContract not configured')
    if (!Number.isFinite(params.amountXlm) || params.amountXlm <= 0) {
      throw new Error('Escrow amount must be greater than zero')
    }

    const walletPub = Keypair.fromSecret(params.walletSecret).publicKey()
    const amountStroops = BigInt(Math.round(params.amountXlm * 10_000_000))

    // Never fund a tag this wallet does not own: the deposit would be
    // stranded (see DeviceNotLinkedError).
    const ownership = await this.getDeviceOwnership(params.deviceHashHex, walletPub)
    if (ownership.status === 'other') throw new DeviceOwnedByOtherWalletError(ownership.owner, ownership.createdAt)
    if (ownership.status !== 'mine') throw new DeviceNotLinkedError()

    // Refuse up front rather than letting the token transfer fail on-chain:
    // the account must keep its base reserve after the deposit.
    const bal = await stellarService.getBalance(walletPub)
    const spendable = spendableBalance(bal.xlm, bal.subentryCount ?? 0)
    if (params.amountXlm > spendable) {
      throw new InsufficientFundsError(params.amountXlm, spendable)
    }

    // Wait for finality: the caller refreshes balance_of right after, and a
    // fire-and-forget submit could still fail after we reported success.
    const hash = await stellarService.invokeContractAndWait({
      ...sdkCall(walletPub, { kind: 'fundEscrow', deviceHash: params.deviceHashHex, token: nativeXlmSac(), amount: amountStroops }),
      signerSecret: params.walletSecret,
    })
    stellarService.invalidateBalance?.(walletPub)
    return hash
  },

  /**
   * Owner withdraws part of a device's escrow back to their wallet
   * (payment_escrow.defund_escrow). The contract resolves the owner from
   * device_registry and requires their auth.
   */
  async withdrawEscrow(params: {
    walletSecret: string
    deviceHashHex: string
    amountStroops: bigint
  }): Promise<string> {
    const contractId = AppConfig.stellar.paymentEscrowContract
    if (!contractId) throw new Error('paymentEscrowContract not configured')
    if (params.amountStroops <= 0n) throw new Error('Withdrawal amount must be greater than zero')

    const walletPub = Keypair.fromSecret(params.walletSecret).publicKey()
    const hash = await stellarService.invokeContractAndWait({
      ...sdkCall(walletPub, { kind: 'defundEscrow', deviceHash: params.deviceHashHex, token: nativeXlmSac(), amount: params.amountStroops }),
      signerSecret: params.walletSecret,
    })
    stellarService.invalidateBalance?.(walletPub)
    return hash
  },

  /**
   * Unlink a tag from this wallet without stranding funds.
   *
   * Order is load-bearing:
   *   1. revoke_agent       — sweep_on_revoke refuses while an agent is live
   *   2. sweep_on_revoke    — returns the full escrow balance to the owner
   *   3. device revoke      — deletes the device entry; after this get_owner
   *                           fails, so any escrow left behind is unrecoverable
   *
   * Each step is decided by a read first, so every write is expected to
   * succeed and the steps share one source account without sequence gaps.
   * Any failure aborts BEFORE the device is revoked; the whole call is
   * idempotent, so the user can simply retry.
   */
  async unlinkDevice(params: {
    walletSecret: string
    deviceHashHex: string
    /**
     * Fallback agent address for the sweep when the agent is already revoked.
     * sweep_on_revoke only requires that this address is NOT authorized, so
     * the owner wallet itself is a safe last resort.
     */
    agentPublicKey?: string
  }): Promise<{ agentRevoked: boolean; sweptStroops: bigint; deviceRevoked: boolean }> {
    const deviceId = AppConfig.stellar.deviceRegistryContract
    const agentId = AppConfig.stellar.agentRegistryContract
    const escrowId = AppConfig.stellar.paymentEscrowContract
    if (!deviceId || !agentId || !escrowId) throw new Error('Contracts not configured')

    const pub = Keypair.fromSecret(params.walletSecret).publicKey()
    const deviceHash = params.deviceHashHex

    const [ownership, policy, escrow] = await Promise.all([
      this.getDeviceOwnership(params.deviceHashHex, pub),
      this.getAgentPolicy(params.deviceHashHex, pub),
      this.getEscrowBalance(params.deviceHashHex, pub),
    ])
    if (ownership.status === 'other') {
      throw new DeviceOwnedByOtherWalletError(ownership.owner, ownership.createdAt)
    }

    const account = await stellarService.loadSourceAccount(pub)
    const result = { agentRevoked: false, sweptStroops: 0n, deviceRevoked: false }

    if (policy) {
      await stellarService.invokeContractAndWait({
        ...sdkCall(pub, { kind: 'revokeAgent', deviceHash }),
        signerSecret: params.walletSecret,
        sourceAccount: account,
      })
      result.agentRevoked = true
    }

    if (escrow > 0n) {
      if (ownership.status !== 'mine') {
        // Device already gone → owner can't be resolved → nothing we can do.
        throw new Error('Escrow balance remains but the device is no longer registered')
      }
      await stellarService.invokeContractAndWait({
        ...sdkCall(pub, { kind: 'sweepOnRevoke', deviceHash, token: nativeXlmSac(), agent: policy?.agent ?? params.agentPublicKey ?? pub }),
        signerSecret: params.walletSecret,
        sourceAccount: account,
      })
      result.sweptStroops = escrow
    }

    if (ownership.status === 'mine') {
      await stellarService.invokeContractAndWait({
        ...sdkCall(pub, { kind: 'revokeDevice', deviceHash }),
        signerSecret: params.walletSecret,
        sourceAccount: account,
      })
      result.deviceRevoked = true
    }

    stellarService.invalidateBalance?.(pub)
    return result
  },

  /**
   * Escrow balance for a device, in stroops. `source` is any funded account
   * used to simulate the read — pass the owner wallet, since a freshly
   * derived agent may not exist on-chain yet.
   */
  async getEscrowBalance(deviceHashHex: string, source: string): Promise<bigint> {
    const contractId = AppConfig.stellar.paymentEscrowContract
    if (!contractId) return 0n

    const result = await stellarService.readContract({
      contractId,
      method: 'balance_of',
      args: [stellarService.deviceHashScVal(deviceHashHex)],
      source,
    })
    return BigInt(scValToNative(result))
  },

  /**
   * The constrained delegation policy stored for a device, or null when no
   * agent is registered for it (AgentNotFound).
   */
  async getAgentPolicy(deviceHashHex: string, source: string): Promise<OnChainAgentPolicy | null> {
    const contractId = AppConfig.stellar.agentRegistryContract
    if (!contractId) return null
    try {
      const val = await stellarService.readContract({
        contractId,
        method: 'get_policy',
        args: [stellarService.deviceHashScVal(deviceHashHex)],
        source,
      })
      const p = scValToNative(val) as { agent: string; max_amount: bigint; asset: string; expires_at: bigint }
      return {
        agent: String(p.agent),
        maxAmountStroops: BigInt(p.max_amount),
        asset: String(p.asset),
        expiresAt: BigInt(p.expires_at),
      }
    } catch (e: any) {
      const msg = e?.message ?? ''
      if (contractErrorName('agentRegistry', e) === 'AgentNotFound' || msg.includes('AgentNotFound')) return null
      throw e
    }
  },

  async getPendingBalance(merchantAddress: string, index: number = LEGACY_AGENT_INDEX): Promise<number> {
    const contractId = AppConfig.stellar.paymentEscrowContract
    if (!contractId) return 0

    const source = await SecureStore.getItemAsync(legacyPublicKey(index))
    if (!source) return 0

    const result = await stellarService.readContract({
      contractId,
      method: 'pending_balance',
      args: [addressScVal(merchantAddress)],
      source,
    })
    return Number(result)
  },

  /**
   * Query device_registry for all devices owned by a wallet.
   */
  async getOnChainDevices(walletAddress: string): Promise<{
    deviceUidHash: string
    agentPublicKey: string
    createdAt: string
  }[]> {
    const contractId = AppConfig.stellar.deviceRegistryContract
    if (!contractId) throw new Error('deviceRegistryContract not configured')

    const countScVal = await stellarService.readContract({
      contractId,
      method: 'wallet_device_count',
      args: [stellarService.walletAddressScVal(walletAddress)],
      source: walletAddress,
    })
    const count = Number(countScVal)

    const devices: { deviceUidHash: string; agentPublicKey: string; createdAt: string }[] = []
    for (let i = 0; i < count; i++) {
      const hashScVal = await stellarService.readContract({
        contractId,
        method: 'wallet_device_at',
        args: [stellarService.walletAddressScVal(walletAddress), xdr.ScVal.scvU32(i)],
        source: walletAddress,
      })
      const raw: Uint8Array = hashScVal.bytes()
      const deviceHashHex = toHex(raw)

      const agentScVal = await stellarService.readContract({
        contractId,
        method: 'get_agent',
        args: [stellarService.deviceHashScVal(deviceHashHex)],
        source: walletAddress,
      })
      const agentAddr = Address.fromScVal(agentScVal).toString()

      let createdAt = ''
      try {
        const devScVal = await stellarService.readContract({
          contractId,
          method: 'get_device',
          args: [stellarService.deviceHashScVal(deviceHashHex)],
          source: walletAddress,
        })
        const devVec = devScVal.vec()
        if (devVec && devVec.length >= 4) {
          createdAt = new Date(Number(devVec[3]) * 1000).toISOString()
        }
      } catch { /* non-critical */ }

      devices.push({ deviceUidHash: deviceHashHex, agentPublicKey: agentAddr, createdAt })
    }
    return devices
  },
}
