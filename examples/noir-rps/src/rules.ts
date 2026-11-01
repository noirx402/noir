// Game rules shared by the page and the house server. No I/O here, so both
// sides (and the tests) agree on outcomes, payouts and the fairness check.

export const MOVES = ['rock', 'paper', 'scissors'] as const
export type Move = (typeof MOVES)[number]
export type Outcome = 'win' | 'lose' | 'draw'

const BEATS: Record<Move, Move> = { rock: 'scissors', paper: 'rock', scissors: 'paper' }

/** The round from the player's side. */
export function outcome(player: Move, house: Move): Outcome {
  if (player === house) return 'draw'
  return BEATS[player] === house ? 'win' : 'lose'
}

export function isMove(x: unknown): x is Move {
  return typeof x === 'string' && (MOVES as readonly string[]).includes(x)
}

/** What the house sends back: double on a win, the stake on a draw. */
export function payout(result: Outcome, stake: bigint): bigint {
  return result === 'win' ? stake * 2n : result === 'draw' ? stake : 0n
}

/** Stakes the table accepts, in XLM. */
export const STAKES = ['1', '2', '5'] as const
export const MIN_STAKE = 1_0000000n
export const MAX_STAKE = 5_0000000n

/** Memo on the house's payout for a round. */
export const memoFor = (roundId: string) => `rps:${roundId}`

/**
 * Memo on the player's stake: the round and the player's move. The move is
 * inside the transaction the player signs, so nobody watching the chain can
 * claim the round with a different move.
 */
export const stakeMemo = (roundId: string, move: Move) => `rps:${roundId}:${move[0]}`

export function parseStakeMemo(memo: string | undefined): { roundId: string; move: Move } | null {
  const m = /^rps:([0-9a-f]{16}):([rps])$/.exec(memo ?? '')
  if (!m) return null
  return { roundId: m[1], move: MOVES.find((x) => x[0] === m[2])! }
}

/**
 * The house publishes this before the player pays and reveals `move` and
 * `salt` afterwards, so the player can check it didn't change its move.
 */
export async function commitment(roundId: string, move: Move, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${roundId}:${move}:${salt}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Uniform over the three moves (rejects 255 so 0–254 splits evenly). */
export function randomMove(): Move {
  for (;;) {
    const [b] = crypto.getRandomValues(new Uint8Array(1))
    if (b < 255) return MOVES[b % 3]
  }
}
