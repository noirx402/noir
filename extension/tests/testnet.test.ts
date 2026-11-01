/**
 * Live Testnet run of everything the popup can do with a card, through the
 * same Noir class the service worker uses: link → fund escrow → withdraw →
 * top up agent → change policy → pay → unlink. Opt-in, it needs the network:
 *   npm run test:testnet
 */
import { describe, expect, it } from 'vitest'
import { generateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { Keypair } from '@stellar/stellar-sdk'
import { deriveAgent, deriveFromSeed, seedOf } from '../src/shared/hd'
import { AGENT_TOPUP_XLM, Noir, deviceHashOf, fromStroops } from '../src/shared/noir'

const live = process.env.NOIR_TESTNET === '1'
const friendbot = async (a: string) => {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${a}`)
  if (!r.ok) throw new Error(`friendbot ${r.status}`)
}
const log = (k: string, v: unknown) => console.log(`  ${k}: ${v}`)

describe.skipIf(!live)('Testnet card lifecycle', () => {
  it('links, funds, withdraws, tops up, re-policies, pays and unlinks a card', async () => {
    const noir = new Noir('TESTNET')
    const seed = await seedOf(generateMnemonic(wordlist, 128))
    const wallet = await deriveFromSeed(seed, [44, 148, 0])
    const me = wallet.publicKey()
    await friendbot(me)
    log('wallet', me)

    // A random 7-byte NTAG213-style UID, as the popup would type or scan it.
    const uid = `04:${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join(':')}`
    const deviceHash = await deviceHashOf(uid)
    log('uid', uid)

    const linked = await noir.link({ wallet, seed, deviceHash, maxXlm: 50, expiryDays: 0 })
    expect(linked.alreadyLinked).toBe(false)
    expect(linked.agent).toBe((await deriveAgent(seed, 2)).publicKey())
    let card = await noir.card(deviceHash, me)
    expect(card.active).toBe(true)
    expect(card.policy?.maxAmount).toBe(500_000_000n)
    log('linked, agent', linked.agent)

    // Linking again is a no-op, not a second agent.
    expect((await noir.link({ wallet, seed, deviceHash })).alreadyLinked).toBe(true)

    log('fund escrow', await noir.fundEscrow(wallet, deviceHash, 5))
    log('withdraw', await noir.withdrawEscrow(wallet, deviceHash, 2))
    expect(fromStroops((await noir.card(deviceHash, me)).escrow)).toBe(3)
    await expect(noir.withdrawEscrow(wallet, deviceHash, 10)).rejects.toThrow(/Only 3 XLM/)

    log('top up agent', await noir.topUpAgent(wallet, linked.agent, 3))
    expect((await noir.account(linked.agent)).xlm).toBe(3)

    log('set policy', await noir.setPolicy(wallet, deviceHash, 25, 7))
    card = await noir.card(deviceHash, me)
    expect(card.policy?.maxAmount).toBe(250_000_000n)
    expect(card.policy?.agent).toBe(linked.agent)
    expect(card.policy!.expiresAt! > new Date()).toBe(true)

    // The next card would get the next agent key: 2 is this card's, and its account exists.
    expect((await noir.allocateAgent(seed, me)).index).toBe(3)

    const stranger = Keypair.random().publicKey()
    log('pay (opens account)', await noir.pay(wallet, stranger, 1.5, 'noir test'))
    expect((await noir.account(stranger)).xlm).toBe(1.5)

    const before = (await noir.account(me)).xlm
    const r = await noir.unlink(wallet, deviceHash, await deriveAgent(seed, 2))
    log('unlink', JSON.stringify(r))
    expect(r.escrowReturned).toBe(3)
    expect(r.agentSwept).toBeGreaterThan(1.9)
    expect((await noir.ownership(deviceHash, me)).status).toBe('free')
    expect(await noir.policy(deviceHash)).toBeNull()
    expect((await noir.account(me)).xlm).toBeGreaterThan(before + 4.8)
    expect(await noir.cards(me)).toEqual([])
  }, 300_000)

  it('taps to pay: charge your own card, pay a merchant by card, merchant claims', async () => {
    const noir = new Noir('TESTNET')
    const seed = await seedOf(generateMnemonic(wordlist, 128))
    const wallet = await deriveFromSeed(seed, [44, 148, 0])
    const me = wallet.publicKey()
    const merchantSeed = await seedOf(generateMnemonic(wordlist, 128))
    const merchant = await deriveFromSeed(merchantSeed, [44, 148, 0])
    await Promise.all([friendbot(me), friendbot(merchant.publicKey())])
    log('wallet', me)
    log('merchant', merchant.publicKey())

    const uid = `04:${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join(':')}`
    const deviceHash = await deviceHashOf(uid)
    const { agent } = await noir.link({ wallet, seed, deviceHash, maxXlm: 5, expiryDays: 0 })
    const agentKp = await deriveAgent(seed, 2)
    expect(agent).toBe(agentKp.publicKey())

    // Before funding, the tap is refused with the reason, not a contract panic.
    expect(await noir.tapCheck(deviceHash, agent, 1)).toMatch(/escrow only holds 0/)
    log('fund escrow', await noir.fundEscrow(wallet, deviceHash, 10))
    expect(await noir.tapCheck(deviceHash, agent, 1)).toMatch(/agent account isn’t open/)
    log('top up agent', await noir.topUpAgent(wallet, agent, 2))
    // 1 XLM above the reserve doesn't cover a first tap's Soroban fee: say so before signing.
    expect(await noir.tapCheck(deviceHash, agent, 3)).toMatch(/agent needs about [\d.]+ XLM .* Top up the agent/)
    log('top up agent again', await noir.topUpAgent(wallet, agent, AGENT_TOPUP_XLM))
    expect(await noir.tapCheck(deviceHash, agent, 6)).toMatch(/limit of 5 XLM/)
    expect(await noir.tapCheck(deviceHash, agent, 3)).toBeNull()

    // Charge: authorize to this wallet, then claim it straight back.
    const before = (await noir.account(me)).xlm
    const charged = await noir.charge(wallet, agentKp, deviceHash, 3)
    log('charge authorize', charged.authorizeHash)
    log('charge claim', charged.claimHash)
    expect(fromStroops((await noir.card(deviceHash, me)).escrow)).toBe(7)
    expect(await noir.pendingClaims(me)).toBe(0)
    expect((await noir.account(me)).xlm).toBeGreaterThan(before + 2.99)

    // Pay by card: the merchant gets a pending payment and claims it.
    log('pay by card', await noir.authorize(agentKp, deviceHash, merchant.publicKey(), 4))
    expect(await noir.pendingClaims(merchant.publicKey())).toBe(4)
    const m0 = (await noir.account(merchant.publicKey())).xlm
    const claimed = await noir.claim(merchant)
    log('merchant claim', claimed.hash)
    expect(claimed.xlm).toBe(4)
    expect((await noir.account(merchant.publicKey())).xlm).toBeGreaterThan(m0 + 3.99)
    await expect(noir.claim(merchant)).rejects.toThrow(/Nothing is waiting/)
    expect(fromStroops((await noir.card(deviceHash, me)).escrow)).toBe(3)

    // Send to card: the merchant tapping this card pays its owner.
    expect(await noir.cardRecipient(deviceHash, merchant.publicKey())).toEqual({ address: me, mine: false })
    expect(await noir.cardRecipient(deviceHash, me)).toEqual({ address: agent, mine: true })

    const r = await noir.unlink(wallet, deviceHash, agentKp)
    log('unlink', JSON.stringify(r))
    expect(r.escrowReturned).toBe(3)
  }, 300_000)
})
