import { describe, expect, it } from 'vitest'
import { commitment, MOVES, outcome, parseStakeMemo, payout, randomMove, stakeMemo } from '../src/rules'

describe('rules', () => {
  it('scores every pairing', () => {
    expect(outcome('rock', 'scissors')).toBe('win')
    expect(outcome('paper', 'rock')).toBe('win')
    expect(outcome('scissors', 'paper')).toBe('win')
    expect(outcome('rock', 'paper')).toBe('lose')
    expect(outcome('paper', 'scissors')).toBe('lose')
    expect(outcome('scissors', 'rock')).toBe('lose')
    for (const m of MOVES) expect(outcome(m, m)).toBe('draw')
  })

  it('pays double on a win, the stake on a draw, nothing on a loss', () => {
    expect(payout('win', 10_000_000n)).toBe(20_000_000n)
    expect(payout('draw', 10_000_000n)).toBe(10_000_000n)
    expect(payout('lose', 10_000_000n)).toBe(0n)
  })

  it('round-trips the stake memo within the 28-byte Stellar limit', () => {
    for (const m of MOVES) {
      const memo = stakeMemo('0123456789abcdef', m)
      expect(memo.length).toBeLessThanOrEqual(28)
      expect(parseStakeMemo(memo)).toEqual({ roundId: '0123456789abcdef', move: m })
    }
    expect(parseStakeMemo('rps:0123456789abcdef')).toBeNull()
    expect(parseStakeMemo('rps:0123456789abcdef:x')).toBeNull()
    expect(parseStakeMemo(undefined)).toBeNull()
  })

  it('binds the commitment to round, move and salt', async () => {
    const c = await commitment('r1', 'rock', 'salt')
    expect(c).toMatch(/^[0-9a-f]{64}$/)
    expect(await commitment('r1', 'rock', 'salt')).toBe(c)
    expect(await commitment('r1', 'paper', 'salt')).not.toBe(c)
    expect(await commitment('r2', 'rock', 'salt')).not.toBe(c)
  })

  it('deals every move', () => {
    const seen = new Set(Array.from({ length: 300 }, randomMove))
    expect(seen).toEqual(new Set(MOVES))
  })
})
