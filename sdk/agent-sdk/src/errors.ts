import type { NoirContracts } from './networks.js'

/** Error enums of the three contracts, by code (source: backend/contracts/<name>/src/lib.rs). */
const CODES: Record<keyof NoirContracts, Record<number, string>> = {
  deviceRegistry: { 1: 'AlreadyInitialized', 2: 'DeviceNotFound', 3: 'NotOwner', 4: 'AlreadyRegistered' },
  agentRegistry: { 1: 'AlreadyInitialized', 2: 'AgentNotFound', 3: 'AlreadyRegistered', 4: 'InvalidPolicy', 5: 'NotOwner' },
  paymentEscrow: {
    1: 'AlreadyInitialized', 2: 'InsufficientBalance', 3: 'AgentNotAuthorized', 4: 'NotDeviceOwner',
    5: 'NothingToClaim', 6: 'DuplicateAuth', 7: 'AgentStillActive', 8: 'DeviceNotRegistered',
    9: 'InvalidAsset', 10: 'InvalidRecipient', 11: 'InvalidAmount',
  },
}

/** A Noir contract refused the call (simulation or on-chain), with the contract's own error name. */
export class NoirContractError extends Error {
  constructor(
    readonly contract: keyof NoirContracts,
    readonly code: number,
    readonly errorName: string,
    readonly method: string,
  ) {
    super(`${contract}.${method} failed: ${errorName} (#${code})`)
    this.name = 'NoirContractError'
  }
}

/** Finds `Error(Contract, #N)` in an RPC/simulation message and names it, else null. */
export function parseContractError(contract: keyof NoirContracts, method: string, message: string): NoirContractError | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(message)
  if (!m) return null
  const code = Number(m[1])
  return new NoirContractError(contract, code, CODES[contract][code] ?? `Unknown`, method)
}
