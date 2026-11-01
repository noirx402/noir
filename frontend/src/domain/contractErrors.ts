/**
 * User-facing messages for Soroban contract errors.
 *
 * Contract errors reach the app as text like `HostError: Error(Contract, #3)`.
 * The numeric code is only meaningful per contract (agent_registry #4 is
 * InvalidPolicy, device_registry #4 is AlreadyRegistered), so the caller must
 * say which contract it was talking to. Codes mirror the `#[contracterror]`
 * enums in backend/contracts/<name>/src/lib.rs — keep them in sync.
 */

export type ContractName = 'device_registry' | 'agent_registry' | 'payment_escrow'

const MESSAGES: Record<ContractName, Record<number, string>> = {
  device_registry: {
    1: 'The device registry is already initialized.',
    2: 'This tag is not registered on-chain.',
    3: 'This tag belongs to a different wallet.',
    4: 'This tag is already registered.',
  },
  agent_registry: {
    1: 'The agent registry is already initialized.',
    2: 'No payment agent is authorized for this tag.',
    3: 'A payment agent is already authorized for this tag.',
    4: 'The spending policy was rejected — check the limit and expiry date.',
    5: 'Only the owner of this tag can change its payment agent.',
  },
  payment_escrow: {
    1: 'The escrow contract is already initialized.',
    2: 'Not enough XLM in escrow for this request.',
    3: 'This payment agent is not authorized, has expired, or is over its limit.',
    4: 'Only the owner of this tag can do that.',
    5: 'There is nothing to claim.',
    6: 'This payment was already processed.',
    7: 'Revoke the payment agent before withdrawing its escrow.',
    8: 'This tag is not registered on-chain.',
    9: 'This escrow is held in a different asset.',
    10: 'Payments cannot be sent to the escrow contract itself.',
    11: 'Enter an amount greater than zero.',
  },
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String((err as any)?.message ?? err ?? '')
}

/** Extract the numeric contract error code from an error message, if any. */
export function contractErrorCode(err: unknown): number | null {
  const m = messageOf(err).match(/Error\(Contract, #(\d+)\)/)
  return m ? Number(m[1]) : null
}

/**
 * Turn any error from a contract call into a sentence safe to show a user.
 * Network/timeout failures get a generic retry message instead of RPC noise.
 */
export function describeContractError(contract: ContractName, err: unknown): string {
  const code = contractErrorCode(err)
  if (code != null && MESSAGES[contract][code]) return MESSAGES[contract][code]

  const msg = messageOf(err)
  if (/insufficient|underfunded|txINSUFFICIENT_BALANCE/i.test(msg)) {
    return 'Your wallet does not have enough XLM for this transaction and its network fee.'
  }
  if (/txBAD_SEQ/i.test(msg)) {
    return 'Another transaction from this wallet was in progress. Please try again.'
  }
  if (/timed? ?out|network|ECONN|fetch failed|Could not load source account/i.test(msg)) {
    return 'Could not reach the Stellar network. Check your connection and try again.'
  }
  return 'The transaction could not be completed. Please try again.'
}
