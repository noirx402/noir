import Link from 'next/link'
import { DocPage } from '@/components/DocPage'
import { CodeBlock } from '@/components/CodeBlock'
import { docMetadata } from '@/lib/docs'

export const metadata = docMetadata('quickstart')

export default function Quickstart() {
  return (
    <DocPage slug="quickstart">
      <h2 id="sdk">Option A — the SDK</h2>
      <p>Install it next to the Stellar SDK:</p>
      <CodeBlock lang="bash" code="npm install @noirx402/agent-sdk @stellar/stellar-sdk" />
      <p>Read a card’s policy and ask the contract whether a payment would go through. Reads need no account and no key.</p>
      <CodeBlock title="check.ts" lang="ts" code={`
import { NoirAgentClient } from '@noirx402/agent-sdk'

const noir = new NoirAgentClient() // Noir's Testnet contracts are built in

const deviceHash = process.argv[2] // 64 hex chars, from the tap
const policy = await noir.getPolicy(deviceHash)
console.log(policy) // { agent, maxAmount, asset, expiresAt } or null

if (policy) {
  const check = await noir.checkPayment({
    deviceHash, agent: policy.agent, asset: policy.asset, amount: 10_000_000n, // 1 XLM
  })
  console.log(check) // { ok: true } or { ok: false, reason: 'over_limit' | 'expired' | … }
}
`} />
      <p>To charge the card, the agent key signs <code>authorizePayment</code>; the merchant later calls <code>claim</code>. See the <Link href="/docs/sdk/#pay">SDK reference</Link>.</p>

      <h2 id="api">Option B — the REST API</h2>
      <p>Run the gateway (or use one your team hosts) and create a key:</p>
      <CodeBlock lang="bash" code={`
git clone https://github.com/noirx402/noir && cd noir/sdk/noir-api
npm run setup && npm run build
npm run keygen -- my-shop --scopes read,write,webhooks   # prints noir_sk_… once
npm start                                                 # http://localhost:8787
`} />
      <p>Then call it from anything that speaks HTTP:</p>
      <CodeBlock lang="bash" code={`
export NOIR_KEY=noir_sk_xxxxxxxx_…

curl http://localhost:8787/v1/devices/$DEVICE_HASH -H "Authorization: Bearer $NOIR_KEY"

curl -X POST http://localhost:8787/v1/payments/check -H "Authorization: Bearer $NOIR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"deviceHash":"'$DEVICE_HASH'","agent":"G…","asset":"C…","amount":"10000000"}'
`} />

      <h2 id="next">Next</h2>
      <ul className="doc-list">
        <li><Link href="/docs/api/#transactions">Charge a card through the API</Link> (prepare → sign → submit)</li>
        <li><Link href="/docs/webhooks/">Get notified when a payment lands</Link></li>
      </ul>
    </DocPage>
  )
}
