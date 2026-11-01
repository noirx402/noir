// The house: deals rounds with a committed move, checks the player's stake
// on-chain, then pays out. Network access is injected so tests can fake it.
import { toStroops } from '@noirx402/agent-sdk'
import {
  commitment, MAX_STAKE, memoFor, MIN_STAKE, outcome, parseStakeMemo, payout, randomHex, randomMove,
  type Move, type Outcome,
} from '../src/rules.js'

export interface StakePayment {
  successful: boolean
  memo: string | undefined
  /** Every operation in the transaction; a valid stake has exactly one. */
  operations: { type: string; assetType?: string; from?: string; to?: string; amount?: string }[]
}

export interface HouseChain {
  address: string
  /** Looks up a submitted transaction by hash. */
  getPayment(txHash: string): Promise<StakePayment>
  /** Sends XLM from the house; returns the transaction hash. */
  pay(to: string, amount: bigint, memo: string): Promise<string>
}

interface Round {
  id: string
  houseMove: Move
  salt: string
  commitment: string
  createdAt: number
  state: 'open' | 'settling' | 'settled'
}

export interface PlayResult {
  roundId: string
  player: string
  playerMove: Move
  houseMove: Move
  salt: string
  commitment: string
  outcome: Outcome
  stake: string
  payout: string
  payoutTx: string | null
  payoutError?: string
}

export class HouseError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const ROUND_TTL_MS = 10 * 60_000

export function createHouse(chain: HouseChain, now: () => number = Date.now) {
  const rounds = new Map<string, Round>()
  // Payouts share the house account's sequence number, so send them one at a time.
  let payQueue: Promise<unknown> = Promise.resolve()

  function prune() {
    for (const [id, r] of rounds) if (r.state !== 'settling' && now() - r.createdAt > ROUND_TTL_MS) rounds.delete(id)
  }

  return {
    address: chain.address,

    async newRound() {
      prune()
      const id = randomHex(8)
      const houseMove = randomMove()
      const salt = randomHex(16)
      const round: Round = { id, houseMove, salt, commitment: await commitment(id, houseMove, salt), createdAt: now(), state: 'open' }
      rounds.set(id, round)
      return { roundId: id, commitment: round.commitment, house: chain.address, minStake: MIN_STAKE.toString(), maxStake: MAX_STAKE.toString() }
    },

    /** Settles a round from the stake transaction; the player's move is read from its memo. */
    async play(input: { roundId?: unknown; txHash?: unknown }): Promise<PlayResult> {
      const { roundId, txHash } = input
      if (typeof roundId !== 'string' || typeof txHash !== 'string' || !/^[0-9a-f]{64}$/.test(txHash)) {
        throw new HouseError(400, 'roundId and a 64-hex txHash are required')
      }
      const round = rounds.get(roundId)
      if (!round) throw new HouseError(404, 'Unknown or expired round')
      if (round.state !== 'open') throw new HouseError(409, 'Round already played')
      if (now() - round.createdAt > ROUND_TTL_MS) throw new HouseError(410, 'Round expired')

      round.state = 'settling'
      let player: string
      let stake: bigint
      let move: Move
      try {
        ;({ player, stake, move } = await verifyStake(chain, txHash, round.id))
      } catch (e) {
        round.state = 'open' // let the player retry, e.g. if Horizon hadn't caught up yet
        throw e
      }

      // The stake is on-chain: the round is decided now, whatever happens to the payout.
      round.state = 'settled'
      const result = outcome(move, round.houseMove)
      const owed = payout(result, stake)
      const base = {
        roundId: round.id, player, playerMove: move, houseMove: round.houseMove, salt: round.salt,
        commitment: round.commitment, outcome: result, stake: stake.toString(), payout: owed.toString(),
      }
      if (owed === 0n) return { ...base, payoutTx: null }

      const sent = payQueue.then(() => chain.pay(player, owed, memoFor(round.id)))
      payQueue = sent.catch(() => undefined)
      try {
        return { ...base, payoutTx: await sent }
      } catch (e) {
        return { ...base, payoutTx: null, payoutError: (e as Error).message }
      }
    },
  }
}

async function verifyStake(chain: HouseChain, txHash: string, roundId: string): Promise<{ player: string; stake: bigint; move: Move }> {
  let tx: StakePayment
  try {
    tx = await chain.getPayment(txHash)
  } catch {
    throw new HouseError(404, 'Stake transaction not found on Testnet')
  }
  if (!tx.successful) throw new HouseError(400, 'Stake transaction failed')
  const memo = parseStakeMemo(tx.memo)
  if (memo?.roundId !== roundId) throw new HouseError(400, 'Stake memo does not match this round')
  if (tx.operations.length !== 1) throw new HouseError(400, 'Stake must be a single payment')
  const [op] = tx.operations
  if (op.type !== 'payment' || op.assetType !== 'native' || op.to !== chain.address || !op.from || !op.amount) {
    throw new HouseError(400, 'Stake must be an XLM payment to the house')
  }
  if (op.from === chain.address) throw new HouseError(400, 'The house cannot play itself')
  const stake = toStroops(op.amount)
  if (stake < MIN_STAKE || stake > MAX_STAKE) throw new HouseError(400, 'Stake is outside the table limits')
  return { player: op.from, stake, move: memo.move }
}
