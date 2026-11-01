import { Keypair } from '@stellar/stellar-sdk'
import { mnemonicToSeed } from '@scure/bip39'

/**
 * SEP-5 key derivation (SLIP-10 ed25519), the same scheme the Noir app uses,
 * so a phrase imported here opens the same wallet and the same card agents.
 * Wallet: m/44'/148'/0'. Card agents: m/44'/148'/0'/<n>' (the app's
 * WalletService.deriveAgentAt).
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0005.md
 */
const HARDENED = 0x80000000
const enc = new TextEncoder()

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource))
}

export const seedOf = (mnemonic: string) => mnemonicToSeed(mnemonic.trim().toLowerCase().split(/\s+/).join(' '))

/** SLIP-10 ed25519 along a fully hardened path, e.g. [44, 148, 0]. */
export async function deriveFromSeed(seed: Uint8Array, path: number[]): Promise<Keypair> {
  let I = await hmacSha512(enc.encode('ed25519 seed'), seed)
  let key = I.slice(0, 32)
  let chain = I.slice(32)
  for (const segment of path) {
    const data = new Uint8Array(37)
    data.set(key, 1)
    new DataView(data.buffer).setUint32(33, (segment + HARDENED) >>> 0)
    I = await hmacSha512(chain, data)
    key = I.slice(0, 32)
    chain = I.slice(32)
  }
  return Keypair.fromRawEd25519Seed(Buffer.from(key))
}

export async function deriveKeypair(mnemonic: string, index = 0): Promise<Keypair> {
  return deriveFromSeed(await seedOf(mnemonic), [44, 148, index])
}

/**
 * Agent indexes the app scans when it rebuilds agents from on-chain devices
 * (x402.syncAgentsFromDevices). Index 1 is its legacy agent; new ones start at 2.
 */
export const AGENT_SCAN = 64
export const deriveAgent = (seed: Uint8Array, index: number) => deriveFromSeed(seed, [44, 148, 0, index])
