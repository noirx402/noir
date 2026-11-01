// Stellar Testnet plumbing shared by the page, the house and the tests.
import { Asset, BASE_FEE, Horizon, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import { fromStroops } from '@noirx402/agent-sdk'

export const HORIZON_URL = 'https://horizon-testnet.stellar.org'
export const NETWORK_PASSPHRASE = Networks.TESTNET
export const horizon = new Horizon.Server(HORIZON_URL)
export const explorerTx = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`

/** Unsigned XDR for an XLM payment with a text memo. */
export async function buildPayment(p: { from: string; to: string; amount: bigint; memo: string }): Promise<string> {
  const account = await horizon.loadAccount(p.from)
  return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(Operation.payment({ destination: p.to, asset: Asset.native(), amount: fromStroops(p.amount) }))
    .addMemo(Memo.text(p.memo))
    .setTimeout(120)
    .build()
    .toXDR()
}

/** Submits a signed envelope and returns its hash once it is in a ledger. */
export async function submit(signedXdr: string): Promise<string> {
  const res = await horizon.submitTransaction(TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE))
  return res.hash
}

/** XLM balance in stroops; 0 for an account that doesn't exist yet. */
export async function xlmBalance(address: string): Promise<bigint> {
  try {
    const account = await horizon.loadAccount(address)
    const native = account.balances.find((b) => b.asset_type === 'native')
    return native ? BigInt(native.balance.replace('.', '')) : 0n
  } catch (e) {
    if ((e as { response?: { status?: number } }).response?.status === 404) return 0n
    throw e
  }
}

export async function friendbot(address: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`)
  if (!res.ok && res.status !== 400) throw new Error(`Friendbot failed: ${res.status}`)
}
