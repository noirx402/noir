import Link from 'next/link'
import { DocPage } from '@/components/DocPage'
import { CodeBlock } from '@/components/CodeBlock'
import { docMetadata } from '@/lib/docs'

export const metadata = docMetadata('sdk')

const READS = [
  ['getPolicy(deviceHash)', 'NoirAgentPolicy | null', 'Agent, maxAmount, asset, expiresAt'],
  ['getDeviceOwner(deviceHash)', 'string | null', 'Owner wallet address'],
  ['listDevices(wallet)', 'string[]', 'Device hashes registered to a wallet'],
  ['getEscrowBalance(deviceHash)', 'bigint', 'Escrowed amount, smallest unit'],
  ['getPendingBalance(merchant)', 'bigint', 'What the merchant can claim'],
  ['checkPayment({ deviceHash, agent, asset, amount })', 'PaymentCheck', '{ ok } or { ok: false, reason }'],
]

const OPS = [
  ['authorize', 'agent', 'deviceHash, merchant, asset, amount, nonce'],
  ['claim', 'merchant', 'token'],
  ['registerAgent', 'owner', 'deviceHash, agent, asset, maxAmount, expiresAt?'],
  ['revokeAgent', 'owner', 'deviceHash'],
  ['fundEscrow', 'owner', 'deviceHash, token, amount'],
  ['defundEscrow', 'owner', 'deviceHash, token, amount'],
]

export default function Sdk() {
  return (
    <DocPage slug="sdk">
      <CodeBlock lang="bash" code="npm install @noirx402/agent-sdk @stellar/stellar-sdk" />
      <p>Works in Node 22.23.4+ (or 24.22.1+), browsers and React Native. Secret keys never pass through the SDK unless you choose <code>keypairSigner</code> on a server.</p>

      <h2 id="client">Create a client</h2>
      <CodeBlock lang="ts" code={`
import { NoirAgentClient, TESTNET } from '@noirx402/agent-sdk'

const noir = new NoirAgentClient()                      // Noir on Testnet
const viaMyRpc = new NoirAgentClient({ rpcUrl: 'https://my-rpc.example' })
const myDeploy = new NoirAgentClient({ network: {
  rpcUrl, networkPassphrase, contracts: { deviceRegistry, agentRegistry, paymentEscrow },
} })
`} />

      <h2 id="reads">Reads</h2>
      <div className="table-wrap"><table className="doc-table">
        <thead><tr><th>Method</th><th>Returns</th><th>Notes</th></tr></thead>
        <tbody>{READS.map(([m, r, n]) => <tr key={m}><td><code>{m}</code></td><td><code>{r}</code></td><td>{n}</td></tr>)}</tbody>
      </table></div>
      <p>
        <code>checkPayment</code> asks the contract’s own <code>check_payment</code>, so it can never disagree with what{' '}
        <code>authorize</code> enforces. Refusal reasons: <code>no_agent</code>, <code>wrong_agent</code>, <code>wrong_asset</code>,{' '}
        <code>invalid_amount</code>, <code>over_limit</code>, <code>expired</code>, <code>insufficient_escrow</code>.
      </p>

      <h2 id="signers">Signers</h2>
      <p>Writes take a <code>NoirSigner</code>: any object with <code>publicKey</code> and <code>signTransaction(xdr, {'{ networkPassphrase }'})</code> — the Freighter / Stellar Wallets Kit shape.</p>
      <CodeBlock lang="ts" code={`
import { keypairSigner } from '@noirx402/agent-sdk'

const agent = keypairSigner(process.env.AGENT_SECRET!)   // server-side agent
const merchant = walletKitSigner                         // a connected browser wallet
`} />

      <h3 id="wallet-signers">From a connected wallet</h3>
      <CodeBlock lang="ts" code={`
import { noirExtensionSigner, walletSigner } from '@noirx402/agent-sdk'

const signer = await noirExtensionSigner()            // the Noir extension
const { address } = await StellarWalletsKit.getAddress()
const kitSigner = walletSigner(StellarWalletsKit, address) // any Stellar Wallets Kit wallet
`} />

      <h2 id="amounts">Amounts</h2>
      <p>Contracts work in stroops (1 XLM = 10,000,000). Convert exactly, without floats:</p>
      <CodeBlock lang="ts" code={`
import { toStroops, fromStroops } from '@noirx402/agent-sdk'

toStroops('2.5')          // 25000000n
fromStroops(25000000n)    // '2.5'
`} />

      <h2 id="pay">Tap-to-pay and claim</h2>
      <CodeBlock lang="ts" code={`
const { hash, nonce } = await noir.authorizePayment({
  agent, deviceHash, merchant: merchantAddress, asset, amount: 10_000_000n,
})
// later, in batch:
await noir.claim({ merchant, token: asset })
`} />
      <p><code>nonce</code> must strictly increase per device and agent; the default (milliseconds since epoch) does. Refusals throw <code>NoirContractError</code> with the contract’s error name, e.g. <code>AgentNotAuthorized</code>, <code>InsufficientBalance</code>, <code>DuplicateAuth</code>.</p>

      <h2 id="operations">Every operation</h2>
      <p><code>execute(signer, op)</code> runs any write. The signer is the acting account:</p>
      <div className="table-wrap"><table className="doc-table">
        <thead><tr><th><code>op.kind</code></th><th>Signer</th><th>Fields</th></tr></thead>
        <tbody>{OPS.map(([k, s, f]) => <tr key={k}><td><code>{k}</code></td><td>{s}</td><td><code>{f}</code></td></tr>)}</tbody>
      </table></div>
      <CodeBlock lang="ts" code={`
await noir.execute(ownerWallet, {
  kind: 'registerAgent', deviceHash, agent: agentAddress, asset,
  maxAmount: 50_000_000n, expiresAt: new Date('2027-01-01'),
})
await noir.execute(ownerWallet, { kind: 'fundEscrow', deviceHash, token: asset, amount: 100_000_000n })
`} />
      <h3 id="sign-elsewhere">Sign somewhere else</h3>
      <CodeBlock lang="ts" code={`
const unsignedXdr = await noir.prepare(sourceAddress, op) // simulated, fees and footprint set
const signedXdr = await hardwareWallet.sign(unsignedXdr)
const hash = await noir.submit(signedXdr)                 // resolves once confirmed
`} />

      <h2 id="events">Events</h2>
      <CodeBlock lang="ts" code={`
const stop = noir.watch({
  types: ['payment.authorized'],
  merchant: merchantAddress,
  onEvent: (e) => markOrderPaid(e.txHash, e.amount),
})

const page = await noir.getEvents({ startLedger })   // or { cursor }
const all = await noir.pastEvents(latestLedger - 17_000) // RPC keeps about 7 days
`} />
      <p>Event types and the webhook relay are covered in <Link href="/docs/webhooks/">Webhooks &amp; events</Link>.</p>
    </DocPage>
  )
}
