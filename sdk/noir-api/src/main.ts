import { createServer } from 'node:http'
import { NoirAgentClient } from '@noirx402/agent-sdk'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { KeyStore } from './keys.js'
import { RateLimiter } from './ratelimit.js'
import { WebhookHub } from './webhooks.js'

const cfg = loadConfig()
const keys = new KeyStore(cfg.keys)
if (keys.size === 0) console.warn('noir-api: no API keys configured; every request will get 401. Run `npm run keygen`.')

const client = new NoirAgentClient(cfg.client)
const log = (msg: string) => console.log(`[noir-api] ${msg}`)
const hub = new WebhookHub(client, { file: cfg.webhooksFile, log })
hub.start()

const server = createServer(createApp({
  client, keys, hub,
  limiter: new RateLimiter(),
  defaultRateLimit: cfg.defaultRateLimit,
  corsOrigins: cfg.corsOrigins,
  allowInsecureWebhooks: cfg.allowInsecureWebhooks,
}))

server.listen(cfg.port, () => log(`listening on :${cfg.port} (${keys.size} key(s), contracts ${client.contracts.paymentEscrow.slice(0, 6)}…)`))

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { hub.close(); server.close(() => process.exit(0)) })
}
