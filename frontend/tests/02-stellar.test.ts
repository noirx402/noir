import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'

describe('Stellar Service', () => {
  it('generates valid keypair', () => {
    const kp = Keypair.random()
    expect(kp.publicKey()).toMatch(/^G[A-Z0-9]{55}$/)
    expect(kp.secret()).toMatch(/^S[A-Z0-9]{55}$/)
  })

  it('derives public from secret', () => {
    const kp = Keypair.random()
    const fromSecret = Keypair.fromSecret(kp.secret())
    expect(fromSecret.publicKey()).toBe(kp.publicKey())
  })

  it('produces unique keypairs', () => {
    const a = Keypair.random()
    const b = Keypair.random()
    expect(a.publicKey()).not.toBe(b.publicKey())
  })

  it('createsKeypair returns valid structure', async () => {
    const { stellarService } = await import('@/services/stellar')
    const result = await stellarService.createKeypair()
    expect(result.publicKey).toMatch(/^G/)
    expect(result.secretKey).toMatch(/^S/)
  })

  it('getBalance returns default shape on error', async () => {
    const { stellarService } = await import('@/services/stellar')
    const balance = await stellarService.getBalance('GABC')
    expect(balance).toHaveProperty('xlm')
  })

  it('fundTestnetAccount returns boolean', async () => {
    const { stellarService } = await import('@/services/stellar')
    const kp = Keypair.random()
    const fetchMock = vi.fn()
    global.fetch = fetchMock

    // Mock friendbot response
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ hash: 'test-hash' })),
    })

    const result = await stellarService.fundTestnetAccount(kp.publicKey())
    expect(typeof result).toBe('boolean')
  })

  it('submitPayment returns hash or error', async () => {
    const { stellarService } = await import('@/services/stellar')
    const kp = Keypair.random()
    const result = await stellarService.submitPayment({
      sourceSecret: kp.secret(),
      destination: 'GABC',
      amount: '1',
    })
    expect('hash' in result).toBe(true)
  })

  it('submitPayment handles XLM asset param', async () => {
    const { stellarService } = await import('@/services/stellar')
    const kp = Keypair.random()
    const result = await stellarService.submitPayment({
      sourceSecret: kp.secret(),
      destination: 'GABC',
      amount: '1',
      assetCode: 'XLM',
    })
    expect('hash' in result).toBe(true)
  })

  it('loadAccount returns null on failure', async () => {
    const { stellarService } = await import('@/services/stellar')
    const acc = await stellarService.loadAccount('GABC')
    expect(acc).not.toBeNull()
  })
})

describe('stellarService.getPaymentHistory', () => {
  const records = (me: string, other: string) => [
    { id: '1', type: 'payment', amount: '12.5000000', asset_type: 'native', from: other, to: me, transaction_hash: 'h1', transaction_successful: true, created_at: '2026-10-03T05:00:00Z' },
    { id: '2', type: 'payment', amount: '3.0000000', asset_type: 'native', from: me, to: other, transaction_hash: 'h2', transaction_successful: false, created_at: '2026-10-03T04:00:00Z' },
    { id: '3', type: 'invoke_host_function', asset_balance_changes: [{ asset_type: 'native', from: me, to: 'CESCROW', amount: '5.0000000' }], transaction_hash: 'h3', created_at: '2026-10-02T04:00:00Z' },
    { id: '4', type: 'invoke_host_function', asset_balance_changes: [], transaction_hash: 'h4', created_at: '2026-10-02T03:00:00Z' },
    { id: '5', type: 'create_account', starting_balance: '10000.0000000', funder: other, account: me, transaction_hash: 'h5', created_at: '2026-10-01T00:00:00Z' },
  ]

  it('maps Horizon payment records to transactions with direction', async () => {
    const { Keypair } = await import('@stellar/stellar-sdk')
    const { stellarService } = await import('@/services/stellar-service')
    const me = Keypair.random().publicKey()
    const other = Keypair.random().publicKey()
    const builder: any = {
      forAccount: () => builder, order: () => builder, limit: () => builder, join: () => builder,
      call: async () => ({ records: records(me, other) }),
    }
    ;(stellarService as any).horizon = { payments: () => builder }

    const txs = await stellarService.getPaymentHistory(me)
    expect(txs.map((t) => t.id)).toEqual(['1', '2', '3', '5']) // no-value contract call skipped
    expect(txs[0]).toMatchObject({ direction: 'in', amountCents: 1250, status: 'confirmed', stellarTxHash: 'h1' })
    expect(txs[1]).toMatchObject({ direction: 'out', amountCents: 300, status: 'failed' })
    expect(txs[2]).toMatchObject({ direction: 'out', amountCents: 500, merchantId: 'CESCROW' })
    expect(txs[3]).toMatchObject({ direction: 'in', amountCents: 1000000 })
  })

  it('returns [] for an unfunded account (404)', async () => {
    const { stellarService } = await import('@/services/stellar-service')
    const builder: any = {
      forAccount: () => builder, order: () => builder, limit: () => builder, join: () => builder,
      call: async () => { throw Object.assign(new Error('nf'), { response: { status: 404 } }) },
    }
    ;(stellarService as any).horizon = { payments: () => builder }
    expect(await stellarService.getPaymentHistory('GABC')).toEqual([])
  })
})

// A transient Horizon failure must not be cached as a 0 XLM balance —
// escrow funding pre-checks the balance and would wrongly refuse.
describe('StellarService balance cache', () => {
  it('does not cache failures and can be invalidated after a send', async () => {
    const { StellarService } = await import('@/services/stellar-service')
    const svc = new StellarService({ network: 'testnet' })
    const pub = Keypair.random().publicKey()
    const load = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { response: { status: 503 } }))
      .mockResolvedValueOnce({ balances: [{ asset_type: 'native', balance: '100.0' }], subentry_count: 0 })
      .mockResolvedValueOnce({ balances: [{ asset_type: 'native', balance: '75.0' }], subentry_count: 0 })
    ;(svc as any).horizon.loadAccount = load

    expect((await svc.getBalance(pub)).xlm).toBe(0)     // failure → fallback, not cached
    expect((await svc.getBalance(pub)).xlm).toBe(100)   // refetched
    expect((await svc.getBalance(pub)).xlm).toBe(100)   // served from cache
    svc.invalidateBalance(pub)
    expect((await svc.getBalance(pub)).xlm).toBe(75)    // fresh after invalidation
    expect(load).toHaveBeenCalledTimes(3)
  })
})

// Testnet ledger headers now carry StellarValueType 3 (millisecond close
// times). rpc.Server.getLatestLedger() decodes the whole header, so an SDK
// that predates the new type throws "unknown StellarValueType member for
// value 3" — which broke every signed contract call (NFC tag linking first).
// The auth expiry must come from the simulation response instead.
describe('StellarService.invokeContract auth signing', () => {
  it('takes the auth expiry ledger from the simulation, not getLatestLedger', async () => {
    const sdk = await import('@stellar/stellar-sdk/axios')
    const { StellarService } = await import('@/services/stellar-service')
    const kp = sdk.Keypair.random()
    const contractId = sdk.StrKey.encodeContract(Buffer.alloc(32, 7))
    const entry = new sdk.xdr.SorobanAuthorizationEntry({
      credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddress(
        new sdk.xdr.SorobanAddressCredentials({
          address: new sdk.Address(kp.publicKey()).toScAddress(),
          nonce: sdk.xdr.Int64.fromString('1'),
          signatureExpirationLedger: 0,
          signature: sdk.xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: new sdk.xdr.SorobanAuthorizedInvocation({
        function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new sdk.xdr.InvokeContractArgs({
            contractAddress: new sdk.Address(contractId).toScAddress(),
            functionName: 'register',
            args: [],
          }),
        ),
        subInvocations: [],
      }),
    })

    const svc = new StellarService({ network: 'testnet' })
    const sent: any[] = []
    const getLatestLedger = vi.fn(async () => {
      throw new Error('XDR Read Error: unknown StellarValueType member for value 3')
    })
    ;(svc as any).soroban = {
      simulateTransaction: vi.fn(async () => ({
        _parsed: true,
        id: '1',
        latestLedger: 5000,
        events: [],
        minResourceFee: '1000',
        transactionData: new sdk.SorobanDataBuilder(),
        result: { auth: [entry], retval: sdk.xdr.ScVal.scvVoid() },
      })),
      getLatestLedger,
      sendTransaction: vi.fn(async (tx: any) => {
        sent.push(tx)
        return { status: 'PENDING', hash: 'abc123' }
      }),
    }
    vi.spyOn(svc, 'ensureAccountFunded').mockResolvedValue(true)

    const hash = await svc.invokeContract({
      contractId,
      method: 'register',
      args: [],
      signerSecret: kp.secret(),
      sourceAccount: new sdk.Account(kp.publicKey(), '1'),
    })

    expect(hash).toBe('abc123')
    expect(getLatestLedger).not.toHaveBeenCalled()
    const signedAuth = sent[0].operations[0].auth[0].credentials().address()
    expect(signedAuth.signatureExpirationLedger()).toBe(5010)
    expect(signedAuth.signature().switch().name).toBe('scvVec')
  })
})
