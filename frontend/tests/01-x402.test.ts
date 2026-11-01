import { describe, it, expect, vi, beforeEach } from 'vitest'

const STROOPS_PER_XLM = 10_000_000
const DEFAULT_BUDGET_XLM = 500

// In-memory SecureStore for the multi-agent x402 store.
const mockSecure = new Map<string, string>()
vi.mock('@/services/secureStorage', () => ({
  secureGetItem: vi.fn((k: string) => Promise.resolve(mockSecure.get(k) ?? null)),
  secureSetItem: vi.fn((k: string, v: string) => { mockSecure.set(k, v); return Promise.resolve() }),
  secureDeleteItem: vi.fn((k: string) => { mockSecure.delete(k); return Promise.resolve() }),
}))

vi.mock('@/services/stellar-service', () => ({
  stellarService: {
    fundAccount: vi.fn().mockResolvedValue(true),
    submitPayment: vi.fn().mockResolvedValue({ hash: 'test-mock-hash' }),
    submitCreateAccount: vi.fn().mockResolvedValue({ hash: 'test-create-hash' }),
    getBalance: vi.fn().mockResolvedValue({ xlm: 500 }),
    getBalanceStrict: vi.fn().mockResolvedValue({ xlm: 500, subentryCount: 0 }),
    invokeContract: vi.fn().mockResolvedValue('mock-invoke-hash'),
    readContract: vi.fn().mockResolvedValue('0'),
    accountExists: vi.fn().mockResolvedValue(true),
    registerDevice: vi.fn().mockResolvedValue('mock-register-hash'),
    waitForAccount: vi.fn().mockResolvedValue(true),
    walletAddressScVal: vi.fn().mockReturnValue({}),
    deviceHashScVal: vi.fn().mockReturnValue({}),
  },
}))

import { Keypair } from '@stellar/stellar-sdk'

// A valid 12-word BIP39 mnemonic for deterministic HD derivation in tests.
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// Functional in-memory wallet mock supporting the multi-agent API. Uses the
// real WalletService derivation so agents are deterministic per index.
vi.mock('@/services/wallet', async () => {
  const actual = await vi.importActual<typeof import('@/services/wallet')>('@/services/wallet')
  const svc = new actual.WalletService()
  const state: { agentIndexNext: number; retired: number[] } = { agentIndexNext: 2, retired: [] }
  const derivedMain = Keypair.random()
  return {
    ...actual,
    walletService: {
      loadKeys: vi.fn().mockImplementation(async () => ({
        mnemonic: TEST_MNEMONIC,
        stellarSecret: derivedMain.secret(),
        stellarPublic: derivedMain.publicKey(),
        agentSecret: svc.deriveAgentAt(TEST_MNEMONIC, 1).secret,
        agentPublic: svc.deriveAgentAt(TEST_MNEMONIC, 1).public,
        agentIndexNext: state.agentIndexNext,
        retiredAgentIndexes: state.retired,
      })),
      deriveAgentAt: (m: string, i: number) => svc.deriveAgentAt(m, i),
      saveKeys: vi.fn().mockImplementation(async (k: any) => {
        if (typeof k?.agentIndexNext === 'number') state.agentIndexNext = k.agentIndexNext
        if (Array.isArray(k?.retiredAgentIndexes)) state.retired = [...k.retiredAgentIndexes]
      }),
      allocateAgentIndex: vi.fn().mockImplementation(async () => {
        let index = state.agentIndexNext
        while (state.retired.includes(index)) index++
        state.agentIndexNext = index + 1
        return svc.deriveAgentAt(TEST_MNEMONIC, index)
      }),
      retireAgentIndex: vi.fn().mockImplementation(async (i: number) => {
        if (!state.retired.includes(i)) state.retired.push(i)
      }),
      isAgentIndexRetired: vi.fn().mockImplementation(async (i: number) => state.retired.includes(i)),
      __reset: () => { state.agentIndexNext = 2; state.retired = [] },
    },
  }
})

// Pure logic extracted from x402 service
function calcBudgetAfterPayment(remainingStroops: number, amountXlm: string): number {
  const cost = Math.ceil(parseFloat(amountXlm) * STROOPS_PER_XLM)
  return Math.max(0, remainingStroops - cost)
}

function agentHasBudget(remainingStroops: number, paymentStroops: number): boolean {
  return remainingStroops >= paymentStroops
}

function totalSpentFromBudget(initialBudget: number, remaining: number): number {
  return Math.max(0, initialBudget - remaining)
}

describe('x402 Budget Math', () => {
  it('deducts exact XLM from budget', () => {
    expect(calcBudgetAfterPayment(500 * STROOPS_PER_XLM, '10')).toBe(490 * STROOPS_PER_XLM)
  })

  it('floors at zero when payment exceeds budget', () => {
    expect(calcBudgetAfterPayment(5 * STROOPS_PER_XLM, '10')).toBe(0)
  })

  it('ceil fractional stroop cost', () => {
    expect(calcBudgetAfterPayment(100, '0.00000005')).toBe(99)
  })

  it('zero amount does not change budget', () => {
    expect(calcBudgetAfterPayment(500 * STROOPS_PER_XLM, '0')).toBe(500 * STROOPS_PER_XLM)
  })

  it('handles tiny payments correctly', () => {
    expect(calcBudgetAfterPayment(500 * STROOPS_PER_XLM, '0.0000001')).toBe(500 * STROOPS_PER_XLM - 1)
  })

  it('budget sufficient returns true', () => {
    expect(agentHasBudget(100, 50)).toBe(true)
  })

  it('budget exact returns true', () => {
    expect(agentHasBudget(100, 100)).toBe(true)
  })

  it('budget insufficient returns false', () => {
    expect(agentHasBudget(50, 100)).toBe(false)
  })

  it('zero budget cannot pay', () => {
    expect(agentHasBudget(0, 1)).toBe(false)
  })

  it('tracks total spent correctly', () => {
    const initial = DEFAULT_BUDGET_XLM * STROOPS_PER_XLM
    const after1 = calcBudgetAfterPayment(initial, '50')
    const after2 = calcBudgetAfterPayment(after1, '30')
    expect(totalSpentFromBudget(initial, after1)).toBe(50 * STROOPS_PER_XLM)
    expect(totalSpentFromBudget(initial, after2)).toBe(80 * STROOPS_PER_XLM)
  })

  it('total spent never exceeds initial', () => {
    const initial = DEFAULT_BUDGET_XLM * STROOPS_PER_XLM
    let budget = initial
    const payments = ['100', '200', '300']
    for (const amt of payments) {
      budget = calcBudgetAfterPayment(budget, amt)
    }
    expect(totalSpentFromBudget(initial, budget)).toBeLessThanOrEqual(initial)
  })

  it('10 sequential payments stay within budget', () => {
    let budget = DEFAULT_BUDGET_XLM * STROOPS_PER_XLM
    const payments = ['0.5', '1.2', '0.3', '2.0', '0.8', '1.5', '3.0', '0.1', '0.9', '1.7']
    for (const amt of payments) {
      const cost = Math.ceil(parseFloat(amt) * STROOPS_PER_XLM)
      expect(agentHasBudget(budget, cost)).toBe(true)
      budget = calcBudgetAfterPayment(budget, amt)
    }
    expect(budget).toBeGreaterThan(0)
    expect(budget).toBeLessThan(DEFAULT_BUDGET_XLM * STROOPS_PER_XLM)
  })

  it('rejects payment exceeding entire budget', () => {
    expect(agentHasBudget(100 * STROOPS_PER_XLM, Math.ceil(150 * STROOPS_PER_XLM))).toBe(false)
  })

  it('exact budget boundary depletes to zero', () => {
    expect(calcBudgetAfterPayment(50 * STROOPS_PER_XLM, '50')).toBe(0)
  })

  it('accounts with no budget reject all payments', () => {
    expect(agentHasBudget(0, 1)).toBe(false)
    expect(calcBudgetAfterPayment(0, '1')).toBe(0)
  })
})

describe('x402 multi-agent logic', () => {
  beforeEach(async () => {
    mockSecure.clear()
    vi.clearAllMocks()
    const walletMod = await import('@/services/wallet') as any
    walletMod.walletService.__reset?.()
    const { stellarService } = await import('@/services/stellar-service')
    ;(stellarService.accountExists as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(stellarService.getBalance as ReturnType<typeof vi.fn>).mockResolvedValue({ xlm: 500 })
    ;(stellarService.getBalanceStrict as ReturnType<typeof vi.fn>).mockResolvedValue({ xlm: 500, subentryCount: 0 })
  })

  it('createAgent generates a valid keypair and default budget', async () => {
    const { x402 } = await import('@/domain/x402')
    const agent = await x402.createAgent({ label: 'Card A' })
    expect(agent.publicKey).toMatch(/^G[A-Z0-9]{55}$/)
    expect(agent.isActive).toBe(true)
    expect(agent.spendingBudgetStroops).toBe(500 * 10_000_000)
    expect(agent.totalSpentStroops).toBe(0)
    expect(agent.label).toBe('Card A')
  })

  it('each createAgent call produces a NEW, distinct agent', async () => {
    const { x402 } = await import('@/domain/x402')
    const a = await x402.createAgent({ label: 'Card A' })
    const b = await x402.createAgent({ label: 'Card B' })
    expect(b.publicKey).not.toBe(a.publicKey)
    expect(b.index).not.toBe(a.index)
    const list = await x402.listAgents()
    // legacy migrated agent (index 1) + two new = 3
    expect(list.length).toBeGreaterThanOrEqual(2)
  })

  it('budgets are isolated per agent', async () => {
    const { x402 } = await import('@/domain/x402')
    const a = await x402.createAgent({ label: 'Card A' })
    const b = await x402.createAgent({ label: 'Card B' })
    await x402.payWithAgent({ agentIndex: a.index, destination: 'GABC', amount: '10' })
    const afterA = await x402.getAgent(a.index)
    const afterB = await x402.getAgent(b.index)
    expect(afterA!.totalSpentStroops).toBeGreaterThan(0)
    expect(afterB!.totalSpentStroops).toBe(0) // untouched
  })

  it('hasAgent is true once an agent exists', async () => {
    const { x402 } = await import('@/domain/x402')
    await x402.createAgent()
    expect(await x402.hasAgent()).toBe(true)
  })

  it('a fresh wallet has NO agents until one is created (no phantom Agent 1)', async () => {
    // Regression: deriveKeys() populates agentSecret/agentPublic for every
    // wallet, and the legacy migration used to auto-materialize "Agent 1" from
    // them — so a brand-new wallet with zero devices showed 1 agent on refresh.
    // With no OLD flat keys present, listAgents must return empty.
    const { x402 } = await import('@/domain/x402')
    expect(await x402.listAgents()).toEqual([])
    expect(await x402.hasAgent()).toBe(false)
  })

  it('still migrates a genuine legacy agent from the old flat keys', async () => {
    // The pre-multi-agent build wrote flat SecureStore keys. Those, and only
    // those, are the signal that a real prior agent must be preserved.
    const { x402 } = await import('@/domain/x402')
    const { Keypair } = await import('@stellar/stellar-sdk')
    const legacy = Keypair.random()
    mockSecure.set('x402.agent.secret', legacy.secret())
    mockSecure.set('x402.agent.public', legacy.publicKey())
    const list = await x402.listAgents()
    expect(list.find((a) => a.publicKey === legacy.publicKey())).toBeDefined()
    expect(await x402.hasAgent()).toBe(true)
  })

  it('linkAgentToDevice + getAgentIndexForDevice resolve correctly', async () => {
    const { x402 } = await import('@/domain/x402')
    const a = await x402.createAgent({ label: 'Card A', deviceHash: 'deadbeef' })
    const idx = await x402.getAgentIndexForDevice('deadbeef')
    expect(idx).toBe(a.index)
  })

  it('retireAgent permanently retires the index (never reused)', async () => {
    const { x402 } = await import('@/domain/x402')
    const walletMod = await import('@/services/wallet') as any
    const a = await x402.createAgent({ label: 'Card A' })
    const owner = 'GA7OPG4EHTL7X7JQKRLFNIJF7E4X5Y4JT3Q2H6CVT6JKJNZ5DOJ3BNKC'
    await x402.retireAgent(a.index, owner)
    // index recorded as retired
    expect(await walletMod.walletService.isAgentIndexRetired(a.index)).toBe(true)
    // agent no longer listed
    const list = await x402.listAgents()
    expect(list.find((x: any) => x.index === a.index)).toBeUndefined()
    // a subsequent allocation SKIPS the retired index
    const b = await x402.createAgent({ label: 'Card B' })
    expect(b.index).not.toBe(a.index)
  })

  it('retireAgent sweeps agent XLM back to the owner', async () => {
    const { x402 } = await import('@/domain/x402')
    const { stellarService } = await import('@/services/stellar-service')
    const a = await x402.createAgent({ label: 'Card A' })
    const owner = 'GA7OPG4EHTL7X7JQKRLFNIJF7E4X5Y4JT3Q2H6CVT6JKJNZ5DOJ3BNKC'
    await x402.retireAgent(a.index, owner)
    // sweep issues a payment to the owner
    expect(stellarService.submitPayment).toHaveBeenCalledWith(
      expect.objectContaining({ destination: owner }),
    )
  })

  it('payWithAgent returns error when the target agent does not exist', async () => {
    const { x402 } = await import('@/domain/x402')
    const result = await x402.payWithAgent({ agentIndex: 999, destination: 'GABC', amount: '1' })
    expect('error' in result).toBe(true)
  })

  it('payWithAgent succeeds after creation', async () => {
    const { x402 } = await import('@/domain/x402')
    const a = await x402.createAgent()
    const result = await x402.payWithAgent({
      agentIndex: a.index,
      destination: 'GA7OPG4EHTL7X7JQKRLFNIJF7E4X5Y4JT3Q2H6CVT6JKJNZ5DOJ3BNKC',
      amount: '1',
    })
    expect('hash' in result).toBe(true)
  })

  it('getAgent returns agent data after createAgent', async () => {
    const { x402 } = await import('@/domain/x402')
    const created = await x402.createAgent()
    const fetched = await x402.getAgent(created.index)
    expect(fetched?.publicKey).toBe(created.publicKey)
    expect(fetched?.isActive).toBe(true)
  })

  it('budget decreases after payment', async () => {
    const { x402 } = await import('@/domain/x402')
    const a = await x402.createAgent()
    const before = await x402.getAgent(a.index)
    await x402.payWithAgent({ agentIndex: a.index, destination: 'GABC', amount: '10' })
    const after = await x402.getAgent(a.index)
    expect(after!.totalSpentStroops).toBeGreaterThan(before!.totalSpentStroops)
  })

  it('rejects payment exceeding remaining budget', async () => {
    const { x402 } = await import('@/domain/x402')
    const a = await x402.createAgent()
    const result = await x402.payWithAgent({ agentIndex: a.index, destination: 'GABC', amount: '600' })
    expect('error' in result).toBe(true)
  })

  it('does not submit when budget is exceeded', async () => {
    const { x402 } = await import('@/domain/x402')
    const { stellarService } = await import('@/services/stellar-service')
    const a = await x402.createAgent()
    await x402.payWithAgent({ agentIndex: a.index, destination: 'GABC', amount: '600' })
    expect(stellarService.submitPayment).not.toHaveBeenCalled()
  })

  it('does not friendbot-fund the agent', async () => {
    const { x402 } = await import('@/domain/x402')
    const { stellarService } = await import('@/services/stellar-service')
    await x402.createAgent()
    expect(stellarService.fundAccount).not.toHaveBeenCalled()
  })

  it('payWithAgent returns error when agent account missing on-chain', async () => {
    const { x402 } = await import('@/domain/x402')
    const { stellarService } = await import('@/services/stellar-service')
    ;(stellarService.getBalanceStrict as ReturnType<typeof vi.fn>).mockResolvedValue({ xlm: 0, subentryCount: 0 })
    const a = await x402.createAgent()
    const result = await x402.payWithAgent({ agentIndex: a.index, destination: 'GABC', amount: '1' })
    expect('error' in result && result.error).toMatch(/Top up/)
    expect(stellarService.submitPayment).not.toHaveBeenCalled()
  })

  it('payWithAgent refuses a tap the card balance cannot cover', async () => {
    const { x402 } = await import('@/domain/x402')
    const { stellarService } = await import('@/services/stellar-service')
    ;(stellarService.getBalanceStrict as ReturnType<typeof vi.fn>).mockResolvedValue({ xlm: 3, subentryCount: 0 })
    const a = await x402.createAgent()
    const result = await x402.payWithAgent({ agentIndex: a.index, destination: 'GABC', amount: '5' })
    expect('error' in result && result.error).toMatch(/only has 2\.00 XLM/)
    expect(stellarService.submitPayment).not.toHaveBeenCalled()
  })

  it('payWithAgent reports a slow network as a network problem, not an empty card', async () => {
    const { x402 } = await import('@/domain/x402')
    const { stellarService } = await import('@/services/stellar-service')
    ;(stellarService.getBalanceStrict as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('[getBalance] timed out after 12s'))
    const a = await x402.createAgent()
    const result = await x402.payWithAgent({ agentIndex: a.index, destination: 'GABC', amount: '1' })
    expect('error' in result && result.error).toMatch(/did not respond in time/)
    expect(stellarService.submitPayment).not.toHaveBeenCalled()
  })

  it('resolveAgentIndex finds an unlinked card by its agent key and links it', async () => {
    const { x402 } = await import('@/domain/x402')
    await x402.createAgent({ label: 'Card A' })
    const b = await x402.createAgent({ label: 'Card B' })
    const hash = 'ab'.repeat(32)
    expect(await x402.getAgentIndexForDevice(hash)).toBeNull()
    expect(await x402.resolveAgentIndex(hash, b.publicKey)).toBe(b.index)
    // Linked now — the next lookup takes the fast path.
    expect(await x402.getAgentIndexForDevice(hash)).toBe(b.index)
  })

  it('resolveAgentIndex returns null (never agent 1) for a card whose agent is not on this phone', async () => {
    const { x402 } = await import('@/domain/x402')
    await x402.createAgent({ label: 'Card A' })
    const stranger = Keypair.random().publicKey()
    expect(await x402.resolveAgentIndex('cd'.repeat(32), stranger)).toBeNull()
    expect(await x402.resolveAgentIndex('cd'.repeat(32), null)).toBeNull()
  })

  it('syncAgentsFromDevices rebuilds agents from persisted devices (no agents after login)', async () => {
    const { x402 } = await import('@/domain/x402')
    const { walletService } = await import('@/services/wallet')

    // Simulate a fresh login: device list survives, but NO local agent metadata.
    const agent2 = (walletService as any).deriveAgentAt(TEST_MNEMONIC, 2)
    mockSecure.clear()

    const before = await x402.listAgents()
    expect(before.find((a) => a.publicKey === agent2.public)).toBeUndefined()

    const healed = await x402.syncAgentsFromDevices([
      { deviceUidHash: 'aabbcc', agentPublicKey: agent2.public, label: 'Office Card' },
    ])
    expect(healed).toBeGreaterThan(0)

    // The agent is now materialized and linked to its device.
    const after = await x402.listAgents()
    expect(after.find((a) => a.publicKey === agent2.public)).toBeDefined()
    expect(await x402.getAgentIndexForDevice('aabbcc')).toBe(2)
  })

  it('syncAgentsFromDevices never resurrects a retired agent', async () => {
    const { x402 } = await import('@/domain/x402')
    const { walletService } = await import('@/services/wallet')
    const a = await x402.createAgent({ label: 'Card A', deviceHash: 'ddeeff' })
    const pub = a.publicKey
    await x402.retireAgent(a.index, 'GA7OPG4EHTL7X7JQKRLFNIJF7E4X5Y4JT3Q2H6CVT6JKJNZ5DOJ3BNKC')
    expect(await walletService.isAgentIndexRetired(a.index)).toBe(true)

    // Even with the device still referencing it, the retired agent stays gone.
    await x402.syncAgentsFromDevices([
      { deviceUidHash: 'ddeeff', agentPublicKey: pub, label: 'Card A' },
    ])
    const after = await x402.listAgents()
    expect(after.find((x) => x.publicKey === pub)).toBeUndefined()
  })


  it('sweepAgentFunds sends balance minus the base reserve and fee buffer', async () => {
    const { x402 } = await import('@/domain/x402')
    const { stellarService } = await import('@/services/stellar-service')
    const a = await x402.createAgent()
    const result = await x402.sweepAgentFunds('GA7OPG4EHTL7X7JQKRLFNIJF7E4X5Y4JT3Q2H6CVT6JKJNZ5DOJ3BNKC', a.index)
    expect('hash' in result).toBe(true)
    // 500 XLM balance - (2 base entries * 0.5 reserve) - 0.01 fee buffer = 498.99.
    // The 1 XLM minimum balance MUST be left behind or Stellar rejects the
    // payment with op_underfunded (verified against real testnet). toStellarAmount
    // trims trailing zeros, so the canonical string is '498.99', not '498.9900000'.
    expect(stellarService.submitPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '498.99' }),
    )
  })

  it('sweepAgentFunds bypasses the budget check', async () => {
    const { x402 } = await import('@/domain/x402')
    const a = await x402.createAgent()
    const result = await x402.sweepAgentFunds('GABC', a.index)
    expect('hash' in result).toBe(true)
  })

  it('topUpAgent creates the account when agent missing on-chain', async () => {
    const { x402 } = await import('@/domain/x402')
    const { stellarService } = await import('@/services/stellar-service')
    const a = await x402.createAgent()
    ;(stellarService.accountExists as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const { walletService } = await import('@/services/wallet')
    const keys = await walletService.loadKeys()
    expect(keys).not.toBeNull()
    const hash = await x402.topUpAgent(50, keys!.stellarSecret, a.index)
    expect(hash).toBe('test-create-hash')
    expect(stellarService.submitCreateAccount).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '50.0000000' }),
    )
    expect(stellarService.submitPayment).not.toHaveBeenCalled()
  })

  it('topUpAgent pays normally when agent exists on-chain', async () => {
    const { x402 } = await import('@/domain/x402')
    const { stellarService } = await import('@/services/stellar-service')
    const a = await x402.createAgent()
    const { walletService } = await import('@/services/wallet')
    const keys = await walletService.loadKeys()
    expect(keys).not.toBeNull()
    const hash = await x402.topUpAgent(50, keys!.stellarSecret, a.index)
    expect(hash).toBe('test-mock-hash')
    expect(stellarService.submitPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '50.0000000' }),
    )
  })
})

// Regression: registerDeviceAndAgentOnChain must advance the shared source
// account by exactly ONE sequence per invokeContract call. Previously the
// caller also called account.incrementSequenceNumber() manually, which — on
// top of the increment TransactionBuilder.build() already performs — left a
// one-slot gap. register_agent then submitted with seq N+3 while the account
// was only at N+1 on-chain → txBAD_SEQ, surfaced by Soroban RPC as
// `sendTransaction status=ERROR, errorResultXdr=undefined`.
describe('x402 registerDeviceAndAgentOnChain sequence handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits register then register_agent with consecutive (gap-free) sequences', async () => {
    const { Account, Keypair } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402 } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'deviceRegistryContract', 'get').mockReturnValue('CDEVICE')
    vi.spyOn(AppConfig.stellar, 'agentRegistryContract', 'get').mockReturnValue('CAGENT')

    const wallet = Keypair.random()
    const START_SEQ = '1000'
    // Fresh Account that the flow will mutate, mirroring loadSourceAccount().
    const sharedAccount = new Account(wallet.publicKey(), START_SEQ)

    ;(stellarService.loadSourceAccount as any) = vi
      .fn()
      .mockResolvedValue(sharedAccount)

    // Device not registered, agent not authorized → both writes run.
    ;(stellarService.readContract as any) = vi.fn().mockImplementation(async ({ method }: any) => {
      if (method === 'get_device') throw new Error('Error(Contract, #2)') // DeviceNotFound
      if (method === 'is_auth') return { b: () => false }
      return { b: () => false }
    })

    ;(stellarService.walletAddressScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})

    // Faithfully emulate invokeContract's effect on the shared account:
    // TransactionBuilder.build() raises the source account sequence by one.
    const seqAtCall: Record<string, string> = {}
    ;(stellarService.invokeContractAndWait as any) = vi
      .fn()
      .mockImplementation(async ({ method, sourceAccount }: any) => {
        // Builder stamps (currentSeq + 1) onto the tx, then increments.
        const stamped = (BigInt(sourceAccount.sequenceNumber()) + 1n).toString()
        seqAtCall[method] = stamped
        sourceAccount.incrementSequenceNumber()
        return `${method}-hash`
      })

    await x402.registerDeviceAndAgentOnChain({
      walletSecret: wallet.secret(),
      deviceHashHex: 'a'.repeat(64),
      agentPublicKey: Keypair.random().publicKey(),
    })

    // register used START_SEQ+1, register_agent used START_SEQ+2 — no gap.
    expect(seqAtCall['register']).toBe('1001')
    expect(seqAtCall['register_agent']).toBe('1002')
    expect(BigInt(seqAtCall['register_agent']) - BigInt(seqAtCall['register'])).toBe(1n)
  })

  it('still sequences register_agent correctly when register is skipped (already registered)', async () => {
    process.env.EXPO_PUBLIC_DEVICE_REGISTRY_CONTRACT = 'CDEVICE'
    process.env.EXPO_PUBLIC_AGENT_REGISTRY_CONTRACT = 'CAGENT'
    const { Account, Keypair } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402 } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'deviceRegistryContract', 'get').mockReturnValue('CDEVICE')
    vi.spyOn(AppConfig.stellar, 'agentRegistryContract', 'get').mockReturnValue('CAGENT')

    const wallet = Keypair.random()
    const sharedAccount = new Account(wallet.publicKey(), '2000')
    ;(stellarService.loadSourceAccount as any) = vi.fn().mockResolvedValue(sharedAccount)

    // Device already registered → register is skipped; agent still needs auth.
    ;(stellarService.readContract as any) = vi.fn().mockImplementation(async ({ method }: any) => {
      if (method === 'get_device') return { ok: true } // resolves → deviceRegistered
      if (method === 'is_auth') return { b: () => false }
      return { b: () => false }
    })
    ;(stellarService.walletAddressScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})

    const calls: string[] = []
    const seqAtCall: Record<string, string> = {}
    ;(stellarService.invokeContractAndWait as any) = vi
      .fn()
      .mockImplementation(async ({ method, sourceAccount }: any) => {
        calls.push(method)
        seqAtCall[method] = (BigInt(sourceAccount.sequenceNumber()) + 1n).toString()
        sourceAccount.incrementSequenceNumber()
        return `${method}-hash`
      })

    await x402.registerDeviceAndAgentOnChain({
      walletSecret: wallet.secret(),
      deviceHashHex: 'b'.repeat(64),
      agentPublicKey: Keypair.random().publicKey(),
    })

    expect(calls).toEqual(['register_agent'])
    // First (and only) write takes START_SEQ+1 with no skipped slot.
    expect(seqAtCall['register_agent']).toBe('2001')

    // register_agent must match the on-chain signature:
    // (wallet, device_hash, agent, max_amount: i128, asset: Address, expires_at: u64)
    const agentCall = (stellarService.invokeContractAndWait as any).mock.calls
      .find(([p]: any) => p.method === 'register_agent')[0]
    expect(agentCall.args).toHaveLength(6)
    expect(agentCall.args[3].switch().name).toBe('scvI128')
    expect(agentCall.args[4].switch().name).toBe('scvAddress')
    expect(agentCall.args[5].switch().name).toBe('scvU64')
  })
})

describe('x402 device ownership', () => {
  const deviceInfo = async (owner: string, agent: string) => {
    const { nativeToScVal, Address } = await import('@stellar/stellar-sdk')
    return nativeToScVal({
      agent: new Address(agent).toScVal(),
      created_at: nativeToScVal(1791003657n, { type: 'u64' }),
      owner: new Address(owner).toScVal(),
      status: nativeToScVal(0, { type: 'u32' }),
    })
  }

  beforeEach(() => { vi.clearAllMocks() })

  it('classifies free / mine / other', async () => {
    const { Keypair } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402 } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'deviceRegistryContract', 'get').mockReturnValue('CDEVICE')
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})

    const me = Keypair.random().publicKey()
    const other = Keypair.random().publicKey()
    const agent = Keypair.random().publicKey()

    ;(stellarService.readContract as any) = vi.fn().mockRejectedValue(new Error('HostError: Error(Contract, #2)'))
    expect(await x402.getDeviceOwnership('a'.repeat(64), me)).toEqual({ status: 'free' })

    const info = await deviceInfo(me, agent)
    ;(stellarService.readContract as any) = vi.fn().mockResolvedValue(info)
    expect(await x402.getDeviceOwnership('a'.repeat(64), me)).toMatchObject({
      status: 'mine', owner: me, agent, createdAt: 1791003657, active: true,
    })
    expect(await x402.getDeviceOwnership('a'.repeat(64), other)).toMatchObject({ status: 'other', owner: me })
  })

  it('throws DeviceOwnedByOtherWalletError instead of silently succeeding', async () => {
    const { Account, Keypair } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402, DeviceOwnedByOtherWalletError } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'deviceRegistryContract', 'get').mockReturnValue('CDEVICE')
    vi.spyOn(AppConfig.stellar, 'agentRegistryContract', 'get').mockReturnValue('CAGENT')

    const wallet = Keypair.random()
    const otherOwner = Keypair.random().publicKey()
    const info = await deviceInfo(otherOwner, Keypair.random().publicKey())
    ;(stellarService.loadSourceAccount as any) = vi.fn().mockResolvedValue(new Account(wallet.publicKey(), '1'))
    ;(stellarService.readContract as any) = vi.fn().mockResolvedValue(info)
    ;(stellarService.walletAddressScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.invokeContractAndWait as any) = vi.fn()

    await expect(x402.registerDeviceAndAgentOnChain({
      walletSecret: wallet.secret(),
      deviceHashHex: 'c'.repeat(64),
      agentPublicKey: Keypair.random().publicKey(),
    })).rejects.toBeInstanceOf(DeviceOwnedByOtherWalletError)
    expect(stellarService.invokeContractAndWait).not.toHaveBeenCalled()
  })
})

// Week 2: constrained delegation policy + escrow funding wired to the contracts.
describe('x402 agent policy (constrained delegation)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('buildAgentPolicy converts XLM cap + expiry days into contract units', async () => {
    const { buildAgentPolicy } = await import('@/domain/x402')
    expect(buildAgentPolicy({})).toEqual({ maxAmountStroops: 0n, expiresAt: 0n })
    expect(buildAgentPolicy({ maxAmountXlm: 25, expiryDays: 30, nowSec: 1_000 })).toEqual({
      maxAmountStroops: 250_000_000n,
      expiresAt: BigInt(1_000 + 30 * 86_400),
    })
    expect(buildAgentPolicy({ maxAmountXlm: 0.1234567 }).maxAmountStroops).toBe(1_234_567n)
  })

  it('buildAgentPolicy rejects values register_agent would reject (InvalidPolicy)', async () => {
    const { buildAgentPolicy } = await import('@/domain/x402')
    expect(() => buildAgentPolicy({ maxAmountXlm: -1 })).toThrow()
    expect(() => buildAgentPolicy({ expiryDays: -1 })).toThrow()
    expect(() => buildAgentPolicy({ maxAmountXlm: Number.NaN })).toThrow()
  })

  it('passes the chosen policy into register_agent args', async () => {
    const { Account, Keypair, scValToNative } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402, buildAgentPolicy } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'deviceRegistryContract', 'get').mockReturnValue('CDEVICE')
    vi.spyOn(AppConfig.stellar, 'agentRegistryContract', 'get').mockReturnValue('CAGENT')

    const wallet = Keypair.random()
    ;(stellarService.loadSourceAccount as any) = vi.fn().mockResolvedValue(new Account(wallet.publicKey(), '1'))
    ;(stellarService.readContract as any) = vi.fn().mockImplementation(async ({ method }: any) => {
      if (method === 'get_device') throw new Error('Error(Contract, #2)')
      return { b: () => false }
    })
    ;(stellarService.walletAddressScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.invokeContractAndWait as any) = vi.fn().mockResolvedValue('hash')

    const policy = buildAgentPolicy({ maxAmountXlm: 10, expiryDays: 7, nowSec: 5_000 })
    await x402.registerDeviceAndAgentOnChain({
      walletSecret: wallet.secret(),
      deviceHashHex: 'd'.repeat(64),
      agentPublicKey: Keypair.random().publicKey(),
      policy,
    })

    const agentCall = (stellarService.invokeContractAndWait as any).mock.calls
      .find(([p]: any) => p.method === 'register_agent')[0]
    expect(scValToNative(agentCall.args[3])).toBe(100_000_000n)
    expect(scValToNative(agentCall.args[5])).toBe(BigInt(5_000 + 7 * 86_400))
  })

  it('surfaces agent_registry InvalidPolicy (#4) instead of treating it as already-registered', async () => {
    const { Account, Keypair } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402 } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'deviceRegistryContract', 'get').mockReturnValue('CDEVICE')
    vi.spyOn(AppConfig.stellar, 'agentRegistryContract', 'get').mockReturnValue('CAGENT')

    const wallet = Keypair.random()
    ;(stellarService.loadSourceAccount as any) = vi.fn().mockResolvedValue(new Account(wallet.publicKey(), '1'))
    ;(stellarService.readContract as any) = vi.fn().mockImplementation(async ({ method }: any) => {
      if (method === 'get_device') throw new Error('Error(Contract, #2)')
      return { b: () => false }
    })
    ;(stellarService.walletAddressScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.invokeContractAndWait as any) = vi.fn().mockImplementation(async ({ method }: any) => {
      if (method === 'register_agent') throw new Error('HostError: Error(Contract, #4)')
      return 'hash'
    })

    await expect(x402.registerDeviceAndAgentOnChain({
      walletSecret: wallet.secret(),
      deviceHashHex: 'e'.repeat(64),
      agentPublicKey: Keypair.random().publicKey(),
    })).rejects.toThrow('#4')
  })

  it('getAgentPolicy decodes get_policy and returns null on AgentNotFound', async () => {
    const { Keypair, nativeToScVal, Address, Asset, Networks } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402 } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'agentRegistryContract', 'get').mockReturnValue('CAGENT')
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})

    const agent = Keypair.random().publicKey()
    const sac = Asset.native().contractId(Networks.TESTNET)
    const val = nativeToScVal({
      agent: new Address(agent).toScVal(),
      asset: new Address(sac).toScVal(),
      expires_at: nativeToScVal(1_800_000_000n, { type: 'u64' }),
      max_amount: nativeToScVal(250_000_000n, { type: 'i128' }),
    })
    ;(stellarService.readContract as any) = vi.fn().mockResolvedValue(val)
    expect(await x402.getAgentPolicy('a'.repeat(64), agent)).toEqual({
      agent, asset: sac, maxAmountStroops: 250_000_000n, expiresAt: 1_800_000_000n,
    })

    ;(stellarService.readContract as any) = vi.fn().mockRejectedValue(new Error('HostError: Error(Contract, #2)'))
    expect(await x402.getAgentPolicy('a'.repeat(64), agent)).toBeNull()
  })
})

describe('x402 escrow funding (payment_escrow)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('fundEscrow calls fund_escrow(token, wallet, device_hash, amount: i128)', async () => {
    const { Keypair, scValToNative, Asset, Networks } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402 } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'paymentEscrowContract', 'get').mockReturnValue('CESCROW')
    ;(stellarService.walletAddressScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.getBalance as any) = vi.fn().mockResolvedValue({ xlm: 500, subentryCount: 0 })
    ;(stellarService.invokeContractAndWait as any) = vi.fn().mockResolvedValue('fund-hash')

    const wallet = Keypair.random()
    vi.spyOn(x402, 'getDeviceOwnership').mockResolvedValueOnce({ status: 'mine', owner: wallet.publicKey(), agent: '', createdAt: null, active: true })
    const hash = await x402.fundEscrow({ walletSecret: wallet.secret(), deviceHashHex: 'f'.repeat(64), amountXlm: 25 })

    expect(hash).toBe('fund-hash')
    // Must wait for finality, not fire-and-forget.
    const call = (stellarService.invokeContractAndWait as any).mock.calls[0][0]
    expect(call.contractId).toBe('CESCROW')
    expect(call.method).toBe('fund_escrow')
    expect(call.signerSecret).toBe(wallet.secret())
    expect(call.args).toHaveLength(4)
    expect(scValToNative(call.args[0])).toBe(Asset.native().contractId(Networks.TESTNET))
    expect(scValToNative(call.args[1])).toBe(wallet.publicKey())
    expect(Buffer.from(scValToNative(call.args[2])).toString('hex')).toBe('f'.repeat(64))
    expect(call.args[3].switch().name).toBe('scvI128')
    expect(scValToNative(call.args[3])).toBe(250_000_000n)
  })

  it('fundEscrow rejects zero / negative amounts before signing', async () => {
    const { Keypair } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402 } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'paymentEscrowContract', 'get').mockReturnValue('CESCROW')
    ;(stellarService.invokeContract as any) = vi.fn()

    const secret = Keypair.random().secret()
    await expect(x402.fundEscrow({ walletSecret: secret, deviceHashHex: 'f'.repeat(64), amountXlm: 0 })).rejects.toThrow()
    await expect(x402.fundEscrow({ walletSecret: secret, deviceHashHex: 'f'.repeat(64), amountXlm: -5 })).rejects.toThrow()
    expect(stellarService.invokeContract).not.toHaveBeenCalled()
  })

  it('getEscrowBalance decodes the i128 balance_of result', async () => {
    const { Keypair, nativeToScVal } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const { x402 } = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'paymentEscrowContract', 'get').mockReturnValue('CESCROW')
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.readContract as any) = vi.fn().mockResolvedValue(nativeToScVal(1_000_000_000n, { type: 'i128' }))

    const source = Keypair.random().publicKey()
    expect(await x402.getEscrowBalance('f'.repeat(64), source)).toBe(1_000_000_000n)
    expect((stellarService.readContract as any).mock.calls[0][0]).toMatchObject({ method: 'balance_of', source })
  })
})

describe('x402 escrow safety (production paths)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const setup = async () => {
    const sdk = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const mod = await import('@/domain/x402')
    const { AppConfig } = await import('@/constants/config')
    vi.spyOn(AppConfig.stellar, 'deviceRegistryContract', 'get').mockReturnValue('CDEVICE')
    vi.spyOn(AppConfig.stellar, 'agentRegistryContract', 'get').mockReturnValue('CAGENT')
    vi.spyOn(AppConfig.stellar, 'paymentEscrowContract', 'get').mockReturnValue('CESCROW')
    ;(stellarService.walletAddressScVal as any) = vi.fn().mockReturnValue({})
    ;(stellarService.deviceHashScVal as any) = vi.fn().mockReturnValue({})
    return { sdk, stellarService: stellarService as any, ...mod }
  }

  it('fundEscrow refuses before signing when the wallet cannot keep its reserve', async () => {
    const { sdk, stellarService, x402, InsufficientFundsError } = await setup()
    stellarService.getBalance = vi.fn().mockResolvedValue({ xlm: 20, subentryCount: 0 })
    stellarService.invokeContractAndWait = vi.fn()
    vi.spyOn(x402, 'getDeviceOwnership').mockResolvedValueOnce({ status: 'mine', owner: 'G', agent: '', createdAt: null, active: true })
    await expect(x402.fundEscrow({
      walletSecret: sdk.Keypair.random().secret(), deviceHashHex: 'f'.repeat(64), amountXlm: 25,
    })).rejects.toBeInstanceOf(InsufficientFundsError)
    expect(stellarService.invokeContractAndWait).not.toHaveBeenCalled()
  })

  it('fundEscrow refuses a tag that is not registered to this wallet (funds would be stranded)', async () => {
    const { sdk, stellarService, x402, DeviceNotLinkedError, DeviceOwnedByOtherWalletError } = await setup()
    stellarService.getBalance = vi.fn().mockResolvedValue({ xlm: 500, subentryCount: 0 })
    stellarService.invokeContractAndWait = vi.fn()
    const secret = sdk.Keypair.random().secret()

    vi.spyOn(x402, 'getDeviceOwnership').mockResolvedValueOnce({ status: 'free' })
    await expect(x402.fundEscrow({ walletSecret: secret, deviceHashHex: 'f'.repeat(64), amountXlm: 5 }))
      .rejects.toBeInstanceOf(DeviceNotLinkedError)

    vi.spyOn(x402, 'getDeviceOwnership').mockResolvedValueOnce({ status: 'other', owner: 'GOTHER', agent: '', createdAt: null, active: true })
    await expect(x402.fundEscrow({ walletSecret: secret, deviceHashHex: 'f'.repeat(64), amountXlm: 5 }))
      .rejects.toBeInstanceOf(DeviceOwnedByOtherWalletError)

    expect(stellarService.invokeContractAndWait).not.toHaveBeenCalled()
  })

  it('withdrawEscrow calls defund_escrow(token, device_hash, amount) and waits', async () => {
    const { sdk, stellarService, x402 } = await setup()
    stellarService.invokeContractAndWait = vi.fn().mockResolvedValue('defund-hash')
    await x402.withdrawEscrow({
      walletSecret: sdk.Keypair.random().secret(), deviceHashHex: 'f'.repeat(64), amountStroops: 50_000_000n,
    })
    const call = stellarService.invokeContractAndWait.mock.calls[0][0]
    expect(call.method).toBe('defund_escrow')
    expect(call.args).toHaveLength(3)
    expect(sdk.scValToNative(call.args[2])).toBe(50_000_000n)
    await expect(x402.withdrawEscrow({
      walletSecret: sdk.Keypair.random().secret(), deviceHashHex: 'f'.repeat(64), amountStroops: 0n,
    })).rejects.toThrow()
  })

  // Mocks get_device / get_policy / balance_of reads for unlinkDevice.
  const mockReads = async (stellarService: any, opts: { owner: string | null; agent: string | null; escrow: bigint }) => {
    const { nativeToScVal, Address, Asset, Networks } = await import('@stellar/stellar-sdk')
    stellarService.readContract = vi.fn().mockImplementation(async ({ method }: any) => {
      if (method === 'get_device') {
        if (!opts.owner) throw new Error('Error(Contract, #2)')
        return nativeToScVal({
          agent: new Address(opts.agent ?? opts.owner).toScVal(),
          created_at: nativeToScVal(1n, { type: 'u64' }),
          owner: new Address(opts.owner).toScVal(),
          status: nativeToScVal(0, { type: 'u32' }),
        })
      }
      if (method === 'get_policy') {
        if (!opts.agent) throw new Error('Error(Contract, #2)')
        return nativeToScVal({
          agent: new Address(opts.agent).toScVal(),
          asset: new Address(Asset.native().contractId(Networks.TESTNET)).toScVal(),
          expires_at: nativeToScVal(0n, { type: 'u64' }),
          max_amount: nativeToScVal(0n, { type: 'i128' }),
        })
      }
      if (method === 'balance_of') return nativeToScVal(opts.escrow, { type: 'i128' })
      throw new Error(`unexpected read ${method}`)
    })
  }

  it('unlinkDevice revokes agent, sweeps escrow, THEN revokes device', async () => {
    const { sdk, stellarService, x402 } = await setup()
    const wallet = sdk.Keypair.random()
    const agent = sdk.Keypair.random().publicKey()
    await mockReads(stellarService, { owner: wallet.publicKey(), agent, escrow: 70_000_000n })
    stellarService.loadSourceAccount = vi.fn().mockResolvedValue(new sdk.Account(wallet.publicKey(), '10'))
    const order: string[] = []
    stellarService.invokeContractAndWait = vi.fn().mockImplementation(async ({ method }: any) => { order.push(method); return 'h' })

    const res = await x402.unlinkDevice({ walletSecret: wallet.secret(), deviceHashHex: 'a'.repeat(64) })

    expect(order).toEqual(['revoke_agent', 'sweep_on_revoke', 'revoke'])
    expect(res).toEqual({ agentRevoked: true, sweptStroops: 70_000_000n, deviceRevoked: true })
    // sweep must name the agent that was just revoked
    const sweep = (stellarService.invokeContractAndWait as any).mock.calls.find(([p]: any) => p.method === 'sweep_on_revoke')[0]
    expect(sdk.scValToNative(sweep.args[2])).toBe(agent)
  })

  it('unlinkDevice skips steps already done and never sweeps an empty escrow', async () => {
    const { sdk, stellarService, x402 } = await setup()
    const wallet = sdk.Keypair.random()
    await mockReads(stellarService, { owner: wallet.publicKey(), agent: null, escrow: 0n })
    stellarService.loadSourceAccount = vi.fn().mockResolvedValue(new sdk.Account(wallet.publicKey(), '10'))
    const order: string[] = []
    stellarService.invokeContractAndWait = vi.fn().mockImplementation(async ({ method }: any) => { order.push(method); return 'h' })

    const res = await x402.unlinkDevice({ walletSecret: wallet.secret(), deviceHashHex: 'a'.repeat(64) })
    expect(order).toEqual(['revoke'])
    expect(res.sweptStroops).toBe(0n)
  })

  it('unlinkDevice does NOT revoke the device if the escrow sweep fails (funds would be stranded)', async () => {
    const { sdk, stellarService, x402 } = await setup()
    const wallet = sdk.Keypair.random()
    await mockReads(stellarService, { owner: wallet.publicKey(), agent: sdk.Keypair.random().publicKey(), escrow: 10n })
    stellarService.loadSourceAccount = vi.fn().mockResolvedValue(new sdk.Account(wallet.publicKey(), '10'))
    const order: string[] = []
    stellarService.invokeContractAndWait = vi.fn().mockImplementation(async ({ method }: any) => {
      order.push(method)
      if (method === 'sweep_on_revoke') throw new Error('Transaction timed out after 60s')
      return 'h'
    })

    await expect(x402.unlinkDevice({ walletSecret: wallet.secret(), deviceHashHex: 'a'.repeat(64) })).rejects.toThrow()
    expect(order).not.toContain('revoke')
  })

  it('unlinkDevice refuses a tag owned by another wallet without writing', async () => {
    const { sdk, stellarService, x402, DeviceOwnedByOtherWalletError } = await setup()
    await mockReads(stellarService, { owner: sdk.Keypair.random().publicKey(), agent: null, escrow: 0n })
    stellarService.invokeContractAndWait = vi.fn()
    await expect(x402.unlinkDevice({
      walletSecret: sdk.Keypair.random().secret(), deviceHashHex: 'a'.repeat(64),
    })).rejects.toBeInstanceOf(DeviceOwnedByOtherWalletError)
    expect(stellarService.invokeContractAndWait).not.toHaveBeenCalled()
  })
})

describe('contract error messages', () => {
  it('maps codes per contract — #4 means different things', async () => {
    const { describeContractError, contractErrorCode } = await import('@/domain/contractErrors')
    const e4 = new Error('HostError: Error(Contract, #4)')
    expect(contractErrorCode(e4)).toBe(4)
    expect(describeContractError('agent_registry', e4)).toMatch(/policy/i)
    expect(describeContractError('device_registry', e4)).toMatch(/already registered/i)
    expect(describeContractError('payment_escrow', new Error('Error(Contract, #7)'))).toMatch(/revoke/i)
    expect(describeContractError('agent_registry', new Error('Error(Contract, #5)'))).toMatch(/owner/i)
    expect(describeContractError('payment_escrow', new Error('Error(Contract, #8)'))).toMatch(/not registered/i)
    expect(describeContractError('payment_escrow', new Error('Error(Contract, #9)'))).toMatch(/asset/i)
  })

  it('never leaks raw RPC text for unknown failures', async () => {
    const { describeContractError } = await import('@/domain/contractErrors')
    expect(describeContractError('payment_escrow', new Error('Transaction timed out after 60s'))).toMatch(/network/i)
    expect(describeContractError('payment_escrow', new Error('weird xdr blob AAAA'))).not.toMatch(/xdr/i)
  })
})
