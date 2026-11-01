import { sha256 } from '@noble/hashes/sha2.js'
import { Buffer } from 'buffer'
import type { Device } from '@/types'
import { nfcService } from '@/services/nfc'
import { x402 } from '@/domain/x402'

/** SHA-256 of the tag UID — the same device hash linking registers on-chain. */
export function hashTagUid(uid: string): string {
  return Buffer.from(sha256(new TextEncoder().encode(uid))).toString('hex')
}

/** Wait for a card tap and return its UID + device hash, or null if none was read. */
export async function readCardHash(timeoutMs = 10000): Promise<{ uid: string; hash: string } | null> {
  const tag = await nfcService.readTag(timeoutMs)
  if (!tag?.uid) return null
  return { uid: tag.uid, hash: hashTagUid(tag.uid) }
}

/**
 * Who gets paid when you tap a card to *send*: someone else's card pays its
 * owner (device_registry), your own card on this phone pays its agent wallet.
 * Throws with a sentence the UI can show as-is.
 */
export async function resolveCardRecipient(
  hash: string,
  devices: Pick<Device, 'deviceUidHash' | 'agentPublicKey' | 'label'>[],
  walletPub: string,
): Promise<{ address: string; label: string }> {
  const mine = devices.find((d) => d.deviceUidHash === hash && d.agentPublicKey)
  if (mine?.agentPublicKey) return { address: mine.agentPublicKey, label: `${mine.label} (your card)` }
  const owner = await x402.getDeviceOwnership(hash, walletPub)
  if (owner.status === 'free') throw new Error('This card isn’t linked to a Noir account, so there’s no one to pay.')
  if (owner.status === 'mine') throw new Error('That’s your own card. Use Top up on the card instead.')
  return { address: owner.owner, label: 'Card owner' }
}
