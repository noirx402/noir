import { describe, expect, it, vi } from 'vitest'
import { createHouse, HouseError, type HouseChain, type StakePayment } from '../server/house'
import { commitment, outcome, payout, stakeMemo, type Move } from '../src/rules'

const HOUSE = 'GHOUSE'
const PLAYER = 'GPLAYER'
const TX = 'a'.repeat(64)

function fakeChain(stake: (roundId: string) => StakePayment) {
  let currentRound = ''
  const chain: HouseChain & { pay: ReturnType<typeof vi.fn> } = {
    address: HOUSE,
    getPayment: async () => stake(currentRound),
    pay: vi.fn(async () => 'b'.repeat(64)),
  }
  return { chain, setRound: (id: string) => { currentRound = id } }
}

const payment = (roundId: string, move: Move, over: Partial<StakePayment['operations'][0]> = {}): StakePayment => ({
  successful: true,
  memo: stakeMemo(roundId, move),
  operations: [{ type: 'payment', assetType: 'native', from: PLAYER, to: HOUSE, amount: '2.0000000', ...over }],
})

describe('house', () => {
  it('reveals a move that matches its commitment and pays by the rules', async () => {
    for (const move of ['rock', 'paper', 'scissors'] as Move[]) {
      const { chain, setRound } = fakeChain((id) => payment(id, move))
      const house = createHouse(chain)
      const round = await house.newRound()
      setRound(round.roundId)
      const r = await house.play({ roundId: round.roundId, txHash: TX })

      expect(r.playerMove).toBe(move)
      expect(await commitment(r.roundId, r.houseMove, r.salt)).toBe(round.commitment)
      expect(r.outcome).toBe(outcome(move, r.houseMove))
      expect(BigInt(r.payout)).toBe(payout(r.outcome, 20_000_000n))
      if (r.outcome === 'lose') expect(chain.pay).not.toHaveBeenCalled()
      else expect(chain.pay).toHaveBeenCalledWith(PLAYER, BigInt(r.payout), `rps:${r.roundId}`)
    }
  })

  it('reads the move from the signed memo, so a round cannot be played twice', async () => {
    const { chain, setRound } = fakeChain((id) => payment(id, 'rock'))
    const house = createHouse(chain)
    const round = await house.newRound()
    setRound(round.roundId)
    await house.play({ roundId: round.roundId, txHash: TX })
    await expect(house.play({ roundId: round.roundId, txHash: TX })).rejects.toMatchObject({ status: 409 })
  })

  it.each([
    ['another round', (id: string) => ({ ...payment(id, 'rock'), memo: stakeMemo('ffffffffffffffff', 'rock') })],
    ['a failed tx', (id: string) => ({ ...payment(id, 'rock'), successful: false })],
    ['a non-XLM asset', (id: string) => payment(id, 'rock', { assetType: 'credit_alphanum4' })],
    ['a payment to someone else', (id: string) => payment(id, 'rock', { to: 'GOTHER' })],
    ['a stake over the limit', (id: string) => payment(id, 'rock', { amount: '50' })],
    ['a stake under the limit', (id: string) => payment(id, 'rock', { amount: '0.5' })],
    ['two operations', (id: string) => ({ ...payment(id, 'rock'), operations: [...payment(id, 'rock').operations, ...payment(id, 'rock').operations] })],
  ])('refuses %s and keeps the round open', async (_name, stake) => {
    const { chain, setRound } = fakeChain(stake)
    const house = createHouse(chain)
    const round = await house.newRound()
    setRound(round.roundId)
    await expect(house.play({ roundId: round.roundId, txHash: TX })).rejects.toBeInstanceOf(HouseError)
    expect(chain.pay).not.toHaveBeenCalled()
  })

  it('rejects unknown and expired rounds', async () => {
    let t = 0
    const { chain, setRound } = fakeChain((id) => payment(id, 'rock'))
    const house = createHouse(chain, () => t)
    await expect(house.play({ roundId: 'nope', txHash: TX })).rejects.toMatchObject({ status: 404 })
    const round = await house.newRound()
    setRound(round.roundId)
    t = 11 * 60_000
    await expect(house.play({ roundId: round.roundId, txHash: TX })).rejects.toMatchObject({ status: 410 })
  })

  it('reports a failed payout instead of hiding it', async () => {
    const { chain, setRound } = fakeChain((id) => payment(id, 'rock'))
    chain.pay.mockRejectedValue(new Error('tx_bad_seq'))
    const house = createHouse(chain)
    for (;;) {
      const round = await house.newRound()
      setRound(round.roundId)
      const r = await house.play({ roundId: round.roundId, txHash: TX })
      if (r.outcome === 'lose') continue
      expect(r.payoutTx).toBeNull()
      expect(r.payoutError).toBe('tx_bad_seq')
      break
    }
  })
})
