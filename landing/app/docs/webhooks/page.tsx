import Link from 'next/link'
import { DocPage } from '@/components/DocPage'
import { CodeBlock } from '@/components/CodeBlock'
import { docMetadata } from '@/lib/docs'

export const metadata = docMetadata('webhooks')

const EVENTS = [
  ['device.registered', 'device_registry', 'deviceHash, agent'],
  ['device.revoked', 'device_registry', 'deviceHash'],
  ['agent.registered', 'agent_registry', 'deviceHash, agent'],
  ['agent.revoked', 'agent_registry', 'deviceHash'],
  ['escrow.funded', 'payment_escrow', 'deviceHash, amount'],
  ['escrow.defunded', 'payment_escrow', 'deviceHash, amount'],
  ['escrow.swept', 'payment_escrow', 'deviceHash, amount'],
  ['payment.authorized', 'payment_escrow', 'deviceHash, merchant, amount'],
  ['payment.claimed', 'payment_escrow', 'merchant, amount'],
]

export default function Webhooks() {
  return (
    <DocPage slug="webhooks">
      <h2 id="events">Event types</h2>
      <p>Every event also carries <code>id</code> (unique — dedupe on it), <code>contractId</code>, <code>ledger</code>, <code>ledgerClosedAt</code> and <code>txHash</code>.</p>
      <div className="table-wrap"><table className="doc-table">
        <thead><tr><th>Type</th><th>Contract</th><th>Fields</th></tr></thead>
        <tbody>{EVENTS.map(([t, c, f]) => <tr key={t}><td><code>{t}</code></td><td><code>{c}</code></td><td><code>{f}</code></td></tr>)}</tbody>
      </table></div>

      <h2 id="subscribe">Subscribe through the API</h2>
      <CodeBlock lang="bash" code={`
curl -X POST $NOIR_API/v1/webhooks -H "Authorization: Bearer $NOIR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "url": "https://shop.example/noir", "types": ["payment.authorized"], "merchant": "GMER…" }'
# → { "id": "wh_…", "secret": "whsec_…", … }   store the secret: it is not shown again
`} />
      <p>Filters are optional: <code>types</code>, <code>deviceHash</code>, <code>merchant</code>. One watcher on the gateway serves every subscription.</p>

      <h2 id="relay">…or run the relay yourself</h2>
      <CodeBlock lang="ts" code={`
import { NoirAgentClient, startWebhookRelay } from '@noirx402/agent-sdk'

const stop = startWebhookRelay(new NoirAgentClient(), {
  url: 'https://shop.example/noir', secret: process.env.NOIR_WEBHOOK_SECRET!,
  types: ['payment.authorized'],
})
`} />

      <h2 id="delivery">Delivery</h2>
      <CodeBlock lang="http" title="Request your endpoint receives" code={`
POST /noir HTTP/1.1
Content-Type: application/json
X-Noir-Signature: t=1760342400,v1=5f2b…c9

{"subscription":"wh_…","event":{"type":"payment.authorized","id":"0001…","deviceHash":"ab12…",
 "merchant":"GMER…","amount":"10000000","ledger":512345,"txHash":"9f1c…", …}}
`} />
      <ul className="doc-list">
        <li>Amounts are decimal strings.</li>
        <li>At-least-once: retried with exponential backoff on network errors, <code>429</code> and <code>5xx</code>. Any other <code>4xx</code> stops retries.</li>
        <li>Respond <code>2xx</code> quickly and do the work asynchronously.</li>
      </ul>

      <h2 id="verify">Verify the signature</h2>
      <p><code>v1</code> is HMAC-SHA256 of <code>{'`${t}.${rawBody}`'}</code> with your secret, hex-encoded. Verify against the <b>raw</b> body and reject timestamps older than 5 minutes.</p>
      <CodeBlock lang="ts" title="Node / TypeScript" code={`
import { verifyWebhookSignature } from '@noirx402/agent-sdk'

app.post('/noir', express.raw({ type: 'application/json' }), async (req, res) => {
  const raw = req.body.toString('utf8')
  if (!(await verifyWebhookSignature(SECRET, raw, req.header('x-noir-signature')))) return res.sendStatus(401)
  const { event } = JSON.parse(raw)
  if (await seen(event.id)) return res.sendStatus(200)
  await markOrderPaid(event)
  res.sendStatus(200)
})
`} />
      <CodeBlock lang="python" title="Python" code={`
import hmac, hashlib, time

def verify(secret: str, raw: bytes, header: str, tolerance=300) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t = int(parts["t"])
    if abs(time.time() - t) > tolerance:
        return False
    mac = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, parts["v1"])
`} />
      <p>Need history instead of push? Page through <code>GET /v1/events</code> or <Link href="/docs/sdk/#events"><code>noir.getEvents</code></Link>; RPC keeps about seven days.</p>
    </DocPage>
  )
}
