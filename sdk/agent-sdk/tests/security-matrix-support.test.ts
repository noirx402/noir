import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrKey } from '@stellar/stellar-sdk'
import { matrixRunStatus, securityMatrixContracts, type MatrixRow, type MatrixRunState } from './security-matrix-support.js'

const deviceRegistry = StrKey.encodeContract(Buffer.alloc(32, 1))
const agentRegistry = StrKey.encodeContract(Buffer.alloc(32, 2))
const paymentEscrow = StrKey.encodeContract(Buffer.alloc(32, 3))
const targetEnv = {
  NOIR_DEVICE_REGISTRY: deviceRegistry,
  NOIR_AGENT_REGISTRY: agentRegistry,
  NOIR_PAYMENT_ESCROW: paymentEscrow,
}
const variables = ['NOIR_DEVICE_REGISTRY', 'NOIR_AGENT_REGISTRY', 'NOIR_PAYMENT_ESCROW'] as const
const historicalIds = [
  'CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA',
  'CBTDMJVCFQDIVWZBKAKZ2FQ3UEJNAAUFYCTJ3E4ON2MYXPLPSIXQ25JZ',
  'CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX',
]

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('Offline matrix configuration attempted network access') })
})
afterEach(() => vi.unstubAllGlobals())

describe('security matrix targets', () => {
  it.each([
    {},
    { NOIR_TESTNET: '0' },
    { npm_lifecycle_event: 'test' },
    { NOIR_TESTNET: '0', npm_lifecycle_event: 'test', NOIR_DEVICE_REGISTRY: 'unused-invalid-id' },
  ])('keeps ordinary test runs offline: %j', (env) => {
    expect(securityMatrixContracts(env)).toBeNull()
  })

  describe.each([
    { NOIR_TESTNET: '1' },
    { npm_lifecycle_event: 'test:security-matrix' },
  ])('explicit opt-in %j', (optIn) => {
    it('requires targets instead of falling back to the public deployment', () => {
      expect(() => securityMatrixContracts(optIn)).toThrow(/NOIR_DEVICE_REGISTRY/)
    })

    it('returns three distinct valid explicit targets unchanged', () => {
      expect(securityMatrixContracts({ ...optIn, ...targetEnv })).toEqual({
        deviceRegistry, agentRegistry, paymentEscrow,
      })
    })
  })

  it.each(variables.flatMap((key) => [undefined, '', '   '].map((value) => ({ key, value }))))(
    'requires explicit $key when its value is $value', ({ key, value }) => {
      expect(() => securityMatrixContracts({ NOIR_TESTNET: '1', ...targetEnv, [key]: value })).toThrow(key)
    },
  )

  it.each(variables)('rejects an invalid checksum in %s', (key) => {
    const invalid = deviceRegistry.slice(0, -1) + (deviceRegistry.endsWith('A') ? 'B' : 'A')
    expect(() => securityMatrixContracts({ NOIR_TESTNET: '1', ...targetEnv, [key]: invalid })).toThrow(key)
  })

  it('rejects a malformed contract address', () => {
    expect(() => securityMatrixContracts({ NOIR_TESTNET: '1', ...targetEnv, NOIR_AGENT_REGISTRY: 'not-a-contract' }))
      .toThrow(/NOIR_AGENT_REGISTRY/)
  })

  it.each([
    { NOIR_AGENT_REGISTRY: deviceRegistry },
    { NOIR_PAYMENT_ESCROW: deviceRegistry },
    { NOIR_PAYMENT_ESCROW: agentRegistry },
  ])('rejects the same target assigned to multiple roles: %j', (duplicate) => {
    expect(() => securityMatrixContracts({ NOIR_TESTNET: '1', ...targetEnv, ...duplicate })).toThrow(/distinct|duplicate/i)
  })

  it.each(historicalIds.flatMap((id) => variables.map((key) => ({ id, key }))))(
    'refuses the pre-fix deployment ID $id in $key', ({ id, key }) => {
      expect(() => securityMatrixContracts({ NOIR_TESTNET: '1', ...targetEnv, [key]: id }))
        .toThrow(/pre-fix|vulnerable/i)
    },
  )
})

const completeState: MatrixRunState = { setupComplete: true, completed: true, failedTests: [] }
const successfulRows = (): MatrixRow[] => [
  ['P1', 'accepted'], ['P2', 'accepted'], ['P3', 'accepted'],
  ['P4', 'accepted'], ['P5', 'accepted'], ['P6', 'accepted'],
  ['N1', 'DeviceNotRegistered'], ['N2', 'AgentNotAuthorized'],
  ['N3', 'AgentNotAuthorized'], ['N4', 'AgentNotAuthorized'],
  ['N5', 'InvalidRecipient'], ['N6', 'DuplicateAuth'],
  ['N7a', 'NotOwner'], ['N7b', 'NotOwner'], ['N8', 'InvalidAsset'],
  ['N9', 'AgentNotAuthorized'], ['N10', 'AgentNotAuthorized'],
  ['N11a', 'DeviceNotRegistered'], ['N11b', 'DeviceNotRegistered'], ['N12', 'AlreadyRegistered'],
].map(([id, expected]) => ({
  id, case: id, expected,
  result: expected === 'accepted' ? '✅ accepted' : `✅ refused: ${expected}`,
  hash: expected === 'accepted' ? 'ab'.repeat(32) : undefined,
}))

describe('security matrix evidence status', () => {
  it('passes only a completed run with every required outcome and accepted transaction evidence', () => {
    expect(matrixRunStatus(successfulRows(), completeState)).toBe('PASS')
  })

  it('allows setup observations without counting them as security outcomes', () => {
    const rows = successfulRows()
    rows.push({ id: 'N8 setup', case: 'fund JUNK', expected: 'accepted', result: '✅ accepted', hash: 'cd'.repeat(32) })
    expect(matrixRunStatus(rows, completeState)).toBe('PASS')
  })

  it.each(['P1', 'P6', 'N7b', 'N11b'])('marks a run missing required outcome %s incomplete', (id) => {
    expect(matrixRunStatus(successfulRows().filter((row) => row.id !== id), completeState)).toBe('INCOMPLETE')
  })

  it('marks an empty run incomplete', () => {
    expect(matrixRunStatus([], completeState)).toBe('INCOMPLETE')
  })

  it('marks duplicate outcomes incomplete', () => {
    const rows = successfulRows()
    rows.push({ ...rows[0] })
    expect(matrixRunStatus(rows, completeState)).toBe('INCOMPLETE')
  })

  it('does not let a duplicate hide a missing outcome with the same row count', () => {
    const rows = successfulRows().filter((row) => row.id !== 'N7b')
    rows.push({ ...rows.find((row) => row.id === 'N7a')! })
    expect(matrixRunStatus(rows, completeState)).toBe('INCOMPLETE')
  })

  it.each([
    { setupComplete: false, completed: true, failedTests: [] },
    { setupComplete: true, completed: false, failedTests: [] },
  ])('marks unfinished setup or final verification incomplete: %j', (state) => {
    expect(matrixRunStatus(successfulRows(), state)).toBe('INCOMPLETE')
  })

  it('fails when a balance assertion failed after all transaction observations succeeded', () => {
    expect(matrixRunStatus(successfulRows(), { ...completeState, failedTests: ['P1–P3: escrow balance assertion'] }))
      .toBe('FAIL')
  })

  it('keeps failed tests visible even when the run is incomplete', () => {
    expect(matrixRunStatus([], { setupComplete: false, completed: false, failedTests: ['setup failed'] })).toBe('FAIL')
  })

  it('fails on a refused-case mismatch', () => {
    const rows = successfulRows()
    rows.find((row) => row.id === 'N7b')!.result = '❌ got accepted'
    expect(matrixRunStatus(rows, completeState)).toBe('FAIL')
  })

  it.each(['', 'accepted', '✅ refused: InvalidAsset'])('does not trust a malformed or mismatched result: %s', (result) => {
    const rows = successfulRows()
    rows.find((row) => row.id === 'N7b')!.result = result
    expect(matrixRunStatus(rows, completeState)).toBe('INCOMPLETE')
  })

  it.each([undefined, 'not-a-transaction-hash'])('marks missing or malformed accepted transaction evidence incomplete: %s', (hash) => {
    const rows = successfulRows()
    rows[0].hash = hash
    expect(matrixRunStatus(rows, completeState)).toBe('INCOMPLETE')
  })
})
