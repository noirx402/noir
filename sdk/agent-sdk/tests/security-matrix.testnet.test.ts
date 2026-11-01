/**
 * Week 4 security matrix, live on Stellar Testnet.
 *
 * Runs the approved payment workflow (register → constrained agent → fund →
 * authorize → claim → revoke + sweep) and every SOW reject case against the
 * deployed contracts, with fresh Friendbot accounts, and writes each
 * transaction hash and each refusal to
 * deploy-evidence/week4-security-matrix-<timestamp>.md.
 *
 * Opt in: `npm run test:security-matrix`. Point it at a fresh deployment
 * before the IDs are propagated with NOIR_DEVICE_REGISTRY /
 * NOIR_AGENT_REGISTRY / NOIR_PAYMENT_ESCROW.
 *
 * Refusals surface at simulation (the network never accepts the transaction),
 * so the evidence for a reject case is the contract error the RPC returned.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, onTestFailed } from 'vitest'
import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  Address, Asset, BASE_FEE, Contract, Keypair, Operation, TransactionBuilder, xdr,
} from '@stellar/stellar-sdk'
import {
  NoirAgentClient, NoirContractError, TESTNET, keypairSigner, deviceHashScVal, parseContractError,
  type NoirContracts, type NoirOperation,
} from '../src/index.js'
import { matrixRunStatus, securityMatrixContracts, type MatrixRow, type MatrixRunState } from './security-matrix-support.js'

const EXPLORER = 'https://stellar.expert/explorer/testnet'
const XLM = 10_000_000n
const configuredContracts = securityMatrixContracts(process.env)
const LIVE = configuredContracts !== null
const contracts: NoirContracts = configuredContracts ?? TESTNET.contracts
const noir = new NoirAgentClient({ network: { ...TESTNET, contracts } })
const passphrase = noir.config.networkPassphrase
const NATIVE = Asset.native().contractId(passphrase)

const rows: MatrixRow[] = []
const failedTests: string[] = []
const runState: MatrixRunState = { setupComplete: false, completed: false, failedTests }
const pass = (id: string, c: string, hash: string) =>
  rows.push({ id, case: c, expected: 'accepted', result: '✅ accepted', hash })
const refused = (id: string, c: string, expected: string, got: string) =>
  rows.push({ id, case: c, expected, result: got === expected ? `✅ refused: ${got}` : `❌ got ${got}` })

async function friendbot(kp: Keypair) {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`)
  expect(res.ok).toBe(true)
  return kp
}

/** Contract call or plain operation, signed by `kp`, waited to finality. Contract refusals throw NoirContractError. */
async function send(kp: Keypair, op: xdr.Operation, label: { contract: keyof NoirContracts; method: string }): Promise<string> {
  const account = await noir.server.getAccount(kp.publicKey())
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
    .addOperation(op).setTimeout(300).build()
  let prepared
  try {
    prepared = await noir.server.prepareTransaction(tx)
  } catch (e) {
    throw parseContractError(label.contract, label.method, String((e as Error)?.message ?? e)) ?? e
  }
  prepared.sign(kp)
  return noir.submit(prepared.toXDR())
}

const call = (kp: Keypair, contract: keyof NoirContracts, method: string, args: xdr.ScVal[]) =>
  send(kp, new Contract(contracts[contract]).call(method, ...args), { contract, method })

const addr = (s: string) => new Address(s).toScVal()
const exec = (kp: Keypair, op: NoirOperation) => noir.execute(keypairSigner(kp.secret()), op).then((r) => r.hash)
const register = (owner: Keypair, device: string, agent: Keypair) =>
  call(owner, 'deviceRegistry', 'register', [addr(owner.publicKey()), deviceHashScVal(device), addr(agent.publicKey())])

/** The contract error name a refused call produced, or 'accepted' if it went through. */
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'accepted'
  } catch (e) {
    if (e instanceof NoirContractError) return e.errorName
    throw e
  }
}

const device = () => randomBytes(32).toString('hex')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.runIf(LIVE).sequential('Week 4 security matrix (live Testnet)', () => {
  let owner: Keypair, agent: Keypair, merchant: Keypair, stranger: Keypair
  const d1 = device()
  let nonce = 0n

  beforeEach(() => {
    onTestFailed(({ task }) => { failedTests.push(task.name) })
  })

  beforeAll(async () => {
    ;[owner, agent, merchant, stranger] = await Promise.all(
      [Keypair.random(), Keypair.random(), Keypair.random(), Keypair.random()].map(friendbot),
    )
    runState.setupComplete = true
  }, 120_000)

  afterAll(() => {
    if (rows.length === 0 || !runState.setupComplete) return
    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../deploy-evidence')
    mkdirSync(dir, { recursive: true })
    const link = (h?: string) => (h ? `[\`${h.slice(0, 12)}…\`](${EXPLORER}/tx/${h})` : '—')
    const md = [
      `# Week 4 security matrix — live Testnet run ${ts}`,
      '',
      `**Status: ${matrixRunStatus(rows, runState)}**`,
      `Node: \`${process.version}\`. Failed tests: ${failedTests.length ? failedTests.join('; ') : 'none'}.`,
      'Acceptance also requires this Vitest command to exit 0 and verified deployment artifacts.',
      '',
      'Generated by `sdk/agent-sdk/tests/security-matrix.testnet.test.ts` (`npm run test:security-matrix`).',
      'Refused cases are rejected by the contract at simulation, so they have no transaction hash; the',
      'result column is the contract error the RPC returned.',
      '',
      '| Contract | ID |',
      '|----------|----|',
      ...Object.entries(contracts).map(([k, v]) => `| ${k} | [\`${v}\`](${EXPLORER}/contract/${v}) |`),
      '',
      `Accounts: owner \`${owner.publicKey()}\`, agent \`${agent.publicKey()}\`, merchant \`${merchant.publicKey()}\`, stranger \`${stranger.publicKey()}\`.`,
      '',
      '| # | Case | Expected | Result | Tx |',
      '|---|------|----------|--------|----|',
      ...rows.map((r) => `| ${r.id} | ${r.case} | ${r.expected} | ${r.result} | ${link(r.hash)} |`),
      '',
    ].join('\n')
    writeFileSync(path.join(dir, `week4-security-matrix-${ts}.md`), md)
  })

  // ── Approved payment workflow ──────────────────────────────────────

  it('P1–P3: registers a device, a constrained agent (5 XLM cap, 1 h expiry) and funds 20 XLM', async () => {
    pass('P1', 'device_registry.register (owner)', await register(owner, d1, agent))
    const expiresAt = new Date(Date.now() + 3600_000)
    pass('P2', 'agent_registry.register_agent (cap 5 XLM, native XLM, 1 h)', await exec(owner, {
      kind: 'registerAgent', deviceHash: d1, agent: agent.publicKey(), asset: NATIVE, maxAmount: 5n * XLM, expiresAt,
    }))
    pass('P3', 'payment_escrow.fund_escrow 20 XLM', await exec(owner, { kind: 'fundEscrow', deviceHash: d1, token: NATIVE, amount: 20n * XLM }))
    expect(await noir.getEscrowBalance(d1)).toBe(20n * XLM)
  })

  it('P4–P5: agent authorizes 2 XLM in policy, merchant claims it', async () => {
    nonce = BigInt(Date.now())
    const { hash } = await noir.authorizePayment({
      agent: keypairSigner(agent.secret()), deviceHash: d1, merchant: merchant.publicKey(), asset: NATIVE, amount: 2n * XLM, nonce,
    })
    pass('P4', 'payment_escrow.authorize 2 XLM (tap-to-pay)', hash)
    expect(await noir.getPendingBalance(merchant.publicKey())).toBe(2n * XLM)
    pass('P5', 'payment_escrow.claim (merchant settles)', (await noir.claim({ merchant: keypairSigner(merchant.secret()), token: NATIVE })).hash)
    expect(await noir.getPendingBalance(merchant.publicKey())).toBe(0n)
    expect(await noir.getEscrowBalance(d1)).toBe(18n * XLM)
  })

  // ── Reject cases ───────────────────────────────────────────────────

  const authorize = (signer: Keypair, o: { device?: string; merchant?: string; asset?: string; amount?: bigint; nonce?: bigint }) =>
    exec(signer, {
      kind: 'authorize', deviceHash: o.device ?? d1, merchant: o.merchant ?? merchant.publicKey(),
      asset: o.asset ?? NATIVE, amount: o.amount ?? 1n * XLM, nonce: o.nonce ?? BigInt(Date.now()),
    })

  it('N1: unregistered device — fund_escrow refused', async () => {
    refused('N1', 'fund_escrow for an unregistered device', 'DeviceNotRegistered',
      await refusal(exec(owner, { kind: 'fundEscrow', deviceHash: device(), token: NATIVE, amount: XLM })))
  })

  it('N2: unauthorized agent — authorize refused', async () => {
    refused('N2', 'authorize signed by a key that is not the device agent', 'AgentNotAuthorized', await refusal(authorize(stranger, {})))
  })

  it('N3: spending limit — 6 XLM against a 5 XLM cap refused', async () => {
    refused('N3', 'authorize 6 XLM (cap 5 XLM)', 'AgentNotAuthorized', await refusal(authorize(agent, { amount: 6n * XLM })))
  })

  it('N4: invalid asset — authorize in a token other than the policy asset refused', async () => {
    // Any contract address that is not the policy's asset; check_payment refuses before it is ever called.
    refused('N4', 'authorize with a non-policy asset', 'AgentNotAuthorized', await refusal(authorize(agent, { asset: contracts.deviceRegistry })))
  })

  it('N5: invalid recipient — paying the escrow contract itself refused', async () => {
    refused('N5', 'authorize with merchant = escrow contract', 'InvalidRecipient', await refusal(authorize(agent, { merchant: contracts.paymentEscrow })))
  })

  it('N6: replayed payment request — reused nonce refused', async () => {
    refused('N6', 'authorize replaying the P4 nonce', 'DuplicateAuth', await refusal(authorize(agent, { nonce })))
  })

  it('N7: agent hijack — a stranger cannot revoke the agent or install their own', async () => {
    refused('N7a', 'revoke_agent by a non-owner', 'NotOwner', await refusal(exec(stranger, { kind: 'revokeAgent', deviceHash: d1 })))
    refused('N7b', 'register_agent on someone else’s device', 'NotOwner', await refusal(exec(stranger, {
      kind: 'registerAgent', deviceHash: d1, agent: stranger.publicKey(), asset: NATIVE, maxAmount: 0n,
    })))
  })

  it('N8: cross-asset withdrawal — a deposit in a junk token cannot be withdrawn as XLM', async () => {
    const d = device()
    const junk = new Asset('JUNK', stranger.publicKey())
    const junkSac = junk.contractId(passphrase)
    // Deploying a SAC is not a Noir call; the label only names a failure.
    await send(stranger, Operation.createStellarAssetContract({ asset: junk }), { contract: 'paymentEscrow', method: 'createStellarAssetContract' })
    await register(stranger, d, stranger)
    pass('N8 setup', 'stranger funds own device with 20 JUNK (issuer)', await exec(stranger, { kind: 'fundEscrow', deviceHash: d, token: junkSac, amount: 20n * XLM }))
    refused('N8', 'defund_escrow of the JUNK deposit in native XLM', 'InvalidAsset',
      await refusal(exec(stranger, { kind: 'defundEscrow', deviceHash: d, token: NATIVE, amount: 20n * XLM })))
  })

  it('N9: expired authorization — authorize after expires_at refused', async () => {
    const d = device()
    const shortAgent = await friendbot(Keypair.random())
    await register(owner, d, shortAgent)
    const expiresAt = new Date(Date.now() + 45_000)
    await exec(owner, { kind: 'registerAgent', deviceHash: d, agent: shortAgent.publicKey(), asset: NATIVE, maxAmount: 5n * XLM, expiresAt })
    await exec(owner, { kind: 'fundEscrow', deviceHash: d, token: NATIVE, amount: 2n * XLM })
    await sleep(Math.max(0, expiresAt.getTime() - Date.now()) + 15_000)
    refused('N9', 'authorize after the policy expired', 'AgentNotAuthorized', await refusal(authorize(shortAgent, { device: d })))
    // Clean up so the 2 XLM is not left behind.
    await exec(owner, { kind: 'defundEscrow', deviceHash: d, token: NATIVE, amount: 2n * XLM })
  }, 180_000)

  it('N10: revoked agent — refused, and the escrow sweeps back to the owner', async () => {
    pass('N10 setup', 'agent_registry.revoke_agent (owner)', await exec(owner, { kind: 'revokeAgent', deviceHash: d1 }))
    refused('N10', 'authorize by the revoked agent', 'AgentNotAuthorized', await refusal(authorize(agent, {})))
    pass('P6', 'payment_escrow.sweep_on_revoke returns the 18 XLM balance',
      await call(owner, 'paymentEscrow', 'sweep_on_revoke', [addr(NATIVE), deviceHashScVal(d1), addr(agent.publicKey())]))
    expect(await noir.getEscrowBalance(d1)).toBe(0n)
  })

  it('N11: revoked device — a live agent policy cannot pay once the device is revoked', async () => {
    const d = device()
    const a = await friendbot(Keypair.random())
    await register(owner, d, a)
    await exec(owner, { kind: 'registerAgent', deviceHash: d, agent: a.publicKey(), asset: NATIVE, maxAmount: 0n })
    pass('N11 setup', 'device_registry.revoke with the agent policy still on file',
      await call(owner, 'deviceRegistry', 'revoke', [addr(owner.publicKey()), deviceHashScVal(d)]))
    refused('N11a', 'authorize for the revoked device', 'DeviceNotRegistered', await refusal(authorize(a, { device: d })))
    refused('N11b', 'fund_escrow for the revoked device', 'DeviceNotRegistered',
      await refusal(exec(owner, { kind: 'fundEscrow', deviceHash: d, token: NATIVE, amount: XLM })))
    await exec(owner, { kind: 'revokeAgent', deviceHash: d })
  })

  it('N12: duplicate device registration refused', async () => {
    refused('N12', 'device_registry.register for an already-registered tag', 'AlreadyRegistered',
      await refusal(register(stranger, d1, stranger)))
  })

  it('every case matched its expected outcome', () => {
    expect(matrixRunStatus(rows, { ...runState, completed: true })).toBe('PASS')
    runState.completed = true
  })
})
