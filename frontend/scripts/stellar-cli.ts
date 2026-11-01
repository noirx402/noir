#!/usr/bin/env npx tsx
import { StellarService } from '../src/services/stellar-service'
import { xdr, Address, Keypair } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'

const network = process.env.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
const svc = new StellarService({ network })

async function cmdFund(args: string[]) {
  const [address] = args
  if (!address) { console.error('Usage: stellar fund <address>'); process.exit(1) }
  console.log(`Funding ${address}...`)
  const ok = await svc.fundAccount(address)
  if (ok) {
    console.log('Account funded!')
    const found = await svc.waitForAccount(address)
    if (found) console.log('Account verified on-chain')
  } else {
    console.error('Funding failed')
    process.exit(1)
  }
}

async function cmdBalance(args: string[]) {
  const [address] = args
  if (!address) { console.error('Usage: stellar balance <address>'); process.exit(1) }
  const bal = await svc.getBalance(address)
  console.log(`XLM: ${bal.xlm.toFixed(7)}`)
}

async function cmdCreateWallet() {
  const kp = svc.createKeypair()
  console.log('Public key:', kp.publicKey)
  console.log('Secret key:', kp.secretKey)
  console.log()
  if (network === 'testnet') {
    console.log(`Fund: npm run stellar fund ${kp.publicKey}`)
  }
}

function parseScValArgs(args: string[]): xdr.ScVal[] {
  const scVals: xdr.ScVal[] = []
  for (const arg of args) {
    const colonIdx = arg.indexOf(':')
    if (colonIdx === -1) {
      console.error(`Invalid arg "${arg}" — expected type:value (e.g., bytes:aabb address:GA...)`)
      process.exit(1)
    }
    const type = arg.slice(0, colonIdx)
    const val = arg.slice(colonIdx + 1)
    switch (type) {
      case 'bytes': scVals.push(xdr.ScVal.scvBytes(Buffer.from(val, 'hex'))); break
      case 'address': scVals.push(Address.fromString(val).toScVal()); break
      case 'u32': scVals.push(xdr.ScVal.scvU32(parseInt(val, 10))); break
      case 'i32': scVals.push(xdr.ScVal.scvI32(parseInt(val, 10))); break
      case 'u64': scVals.push(xdr.ScVal.scvU64(new xdr.Uint64(val))); break
      case 'i64': scVals.push(xdr.ScVal.scvI64(new xdr.Int64(val))); break
      case 'bool': scVals.push(xdr.ScVal.scvBool(val === 'true')); break
      case 'string': scVals.push(xdr.ScVal.scvString(val)); break
      default: console.error(`Unknown type: ${type}`); process.exit(1)
    }
  }
  return scVals
}

async function cmdInvoke(args: string[]) {
  const [contractId, method, signerSecret, ...rest] = args
  if (!contractId || !method || !signerSecret) {
    console.error('Usage: stellar invoke <contract-id> <method> <signer-secret> [type:value ...]')
    process.exit(1)
  }
  const scVals = parseScValArgs(rest)
  const hash = await svc.invokeContract({ contractId, method, args: scVals, signerSecret })
  console.log('Transaction hash:', hash)
  console.log('Confirmed!')
}

async function cmdRegisterDevice(args: string[]) {
  const [contractId, deviceHashHex, walletSecret] = args
  if (!contractId || !deviceHashHex || !walletSecret) {
    console.error('Usage: stellar register-device <contract-id> <hash-hex> <wallet-secret>')
    process.exit(1)
  }
  const hash = await svc.registerDevice({ contractId, deviceHashHex, walletSecret })
  console.log('Device registered! Tx hash:', hash)
}

async function cmdTxStatus(args: string[]) {
  const [hash] = args
  if (!hash) { console.error('Usage: stellar tx-status <hash>'); process.exit(1) }
  const r = await svc.getTransactionStatus(hash)
  console.log('Status:', r.status)
  if (r.returnValue) console.log('Result:', r.returnValue)
  if (r.error) console.error('Error:', r.error)
}

async function cmdRead(args: string[]) {
  const [contractId, method, sourcePub, ...rest] = args
  if (!contractId || !method || !sourcePub) {
    console.error('Usage: stellar read <contract-id> <method> <source-pubkey> [type:value ...]')
    process.exit(1)
  }
  const scVals = parseScValArgs(rest)
  const result = await svc.readContract({ contractId, method, args: scVals, source: sourcePub })
  console.log('Result:', result)
}

const HELP = `
Stellar CLI — account management for Noir

USAGE
  npm run stellar <command> [args]

NETWORK
  Set STELLAR_NETWORK=mainnet for mainnet (default: testnet)

COMMANDS
  fund <address>              Fund via Friendbot (testnet)
  balance <address>           Check XLM/token balance
  create-wallet               Generate random keypair
  invoke <contract> <method> <secret> [type:val...]
  register-device <contract> <hash-hex> <secret>
  tx-status <hash>
  read <contract> <method> <pubkey> [type:val...]
  help
`

async function main() {
  const cmd = process.argv[2]
  const args = process.argv.slice(3)
  switch (cmd) {
    case 'fund': await cmdFund(args); break
    case 'balance': await cmdBalance(args); break
    case 'create-wallet': await cmdCreateWallet(); break
    case 'invoke': await cmdInvoke(args); break
    case 'register-device': await cmdRegisterDevice(args); break
    case 'tx-status': await cmdTxStatus(args); break
    case 'read': await cmdRead(args); break
    case 'help': case '--help': case '-h': console.log(HELP); break
    default: console.error(`Unknown: ${cmd}`); console.log(HELP); process.exit(1)
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1) })
