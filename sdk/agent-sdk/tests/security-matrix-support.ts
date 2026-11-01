import { StrKey } from '@stellar/stellar-sdk'
import type { NoirContracts } from '../src/networks.js'

export interface MatrixRow { id: string; case: string; expected: string; result: string; hash?: string }
export interface MatrixRunState { setupComplete: boolean; completed: boolean; failedTests: readonly string[] }

const REQUIRED_MATRIX_CASES = [
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7a', 'N7b', 'N8', 'N9', 'N10', 'N11a', 'N11b', 'N12',
]

export function matrixRunStatus(rows: readonly MatrixRow[], state: MatrixRunState): 'PASS' | 'FAIL' | 'INCOMPLETE' {
  if (state.failedTests.length || rows.some((row) => row.result.startsWith('❌'))) return 'FAIL'
  if (!state.setupComplete || !state.completed) return 'INCOMPLETE'
  if (REQUIRED_MATRIX_CASES.some((id) => rows.filter((row) => row.id === id).length !== 1)) return 'INCOMPLETE'
  for (const row of rows) {
    const expected = row.expected === 'accepted' ? '✅ accepted' : `✅ refused: ${row.expected}`
    if (row.result !== expected) return 'INCOMPLETE'
    if (row.expected === 'accepted' && !/^[a-f0-9]{64}$/i.test(row.hash ?? '')) return 'INCOMPLETE'
  }
  return 'PASS'
}

// Immutable pre-fix deployment: deploy-evidence/deploy-testnet-20261007T050558Z.md.
const PRE_FIX_TESTNET_IDS = new Set([
  'CB4DPMGOA374JIB2ZVD4AHW5GJKQUYNOFGRYNOJ75EFH2KCJSMHOWIRA',
  'CBTDMJVCFQDIVWZBKAKZ2FQ3UEJNAAUFYCTJ3E4ON2MYXPLPSIXQ25JZ',
  'CA5S4S7QGHJHJWVJBYL3CXZXZTNGKXMNZVDAEQNN7NUXFP4D7BYK7HIX',
])

export function securityMatrixContracts(env: NodeJS.ProcessEnv): NoirContracts | null {
  if (env.NOIR_TESTNET !== '1' && env.npm_lifecycle_event !== 'test:security-matrix') return null

  const targets = {
    NOIR_DEVICE_REGISTRY: env.NOIR_DEVICE_REGISTRY ?? '',
    NOIR_AGENT_REGISTRY: env.NOIR_AGENT_REGISTRY ?? '',
    NOIR_PAYMENT_ESCROW: env.NOIR_PAYMENT_ESCROW ?? '',
  }
  for (const [name, id] of Object.entries(targets)) {
    if (!StrKey.isValidContract(id)) throw new Error(`Set ${name} to a valid explicit contract ID.`)
    if (PRE_FIX_TESTNET_IDS.has(id)) {
      throw new Error(`${name} targets the vulnerable pre-fix Testnet deployment; use a reviewed fixed deployment.`)
    }
  }
  if (new Set(Object.values(targets)).size !== 3) throw new Error('Security matrix contract IDs must be distinct.')

  return {
    deviceRegistry: targets.NOIR_DEVICE_REGISTRY,
    agentRegistry: targets.NOIR_AGENT_REGISTRY,
    paymentEscrow: targets.NOIR_PAYMENT_ESCROW,
  }
}
