import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { NoirContractError, TESTNET, type NoirOperation } from '@noirx402/agent-sdk'
import { createApp, type NoirApiClient } from '../src/app.js'
import { generateKey, KeyStore } from '../src/keys.js'
import { RateLimiter } from '../src/ratelimit.js'
import { checkWebhookUrl, WebhookHub } from '../src/webhooks.js'

const HASH = 'ab'.repeat(32)
const G = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'
const C = TESTNET.contracts.paymentEscrow

const prepared: { source: string; op: NoirOperation }[] = []
const client: NoirApiClient = {
  config: TESTNET,
  getDeviceOwner: async (h) => (h === HASH ? G : null),
  getPolicy: async (h) => (h === HASH ? { agent: G, maxAmount: 50_000_000n, asset: C, expiresAt: null } : null),
  getEscrowBalance: async () => 123n,
  getPendingBalance: async () => 7n,
  listDevices: async () => [HASH],
  checkPayment: async (p) => (p.amount > 50_000_000n ? { ok: false, reason: 'over_limit' } : { ok: true }),
  prepare: async (source, op) => { prepared.push({ source, op }); return 'AAAA-unsigned' },
  submit: async (x) => { if (x === 'refused-xdr-envelope') throw new NoirContractError('paymentEscrow', 6, 'DuplicateAuth', 'authorize'); return 'txhash' },
  getEvents: async () => ({ events: [], cursor: '0', latestLedger: 1 }),
} as NoirApiClient

const full = generateKey('full', ['read', 'write', 'webhooks'])
const readOnly = generateKey('ro', ['read'])
const tiny = generateKey('tiny', ['read'], 2)
const other = generateKey('other', ['webhooks'])

let server: Server
let base: string
beforeAll(async () => {
  const hub = new WebhookHub({ watch: () => () => {} })
  server = createServer(createApp({
    client, hub,
    keys: new KeyStore([full.record, readOnly.record, tiny.record, other.record]),
    limiter: new RateLimiter(),
    defaultRateLimit: 1000,
    corsOrigins: ['https://shop.example'],
  }))
  await new Promise<void>((r) => server.listen(0, r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const call = (path: string, key?: string, init: RequestInit = {}) =>
  fetch(base + path, {
    ...init,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
const post = (path: string, key: string, body: unknown) => call(path, key, { method: 'POST', body: JSON.stringify(body) })

describe('auth', () => {
  it('health needs no key', async () => {
    expect((await call('/v1/health')).status).toBe(200)
  })
  it('rejects missing, malformed and unknown keys', async () => {
    expect((await call('/v1/network')).status).toBe(401)
    expect((await call('/v1/network', 'nope')).status).toBe(401)
    const forged = full.key.slice(0, -4) + 'AAAA'
    expect((await call('/v1/network', forged)).status).toBe(401)
  })
  it('accepts X-API-Key as well as Bearer', async () => {
    expect((await call('/v1/network', undefined, { headers: { 'X-API-Key': readOnly.key } })).status).toBe(200)
  })
  it('enforces scopes', async () => {
    const res = await post('/v1/transactions/submit', readOnly.key, { xdr: 'x'.repeat(20) })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('insufficient_scope')
  })
  it('a revoked key stops working', () => {
    const store = new KeyStore([{ ...readOnly.record, disabled: true }])
    expect(store.verify(readOnly.key)).toBeNull()
  })
})

describe('rate limit', () => {
  it('returns 429 with Retry-After once the bucket is empty', async () => {
    expect((await call('/v1/network', tiny.key)).status).toBe(200)
    const second = await call('/v1/network', tiny.key)
    expect(second.headers.get('x-ratelimit-remaining')).toBe('0')
    const third = await call('/v1/network', tiny.key)
    expect(third.status).toBe(429)
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0)
  })
  it('refills over time', () => {
    let t = 0
    const rl = new RateLimiter(() => t)
    expect(rl.take('k', 1).ok).toBe(true)
    expect(rl.take('k', 1).ok).toBe(false)
    t += 60_000
    expect(rl.take('k', 1).ok).toBe(true)
  })
})

describe('reads', () => {
  it('returns a device with amounts as strings', async () => {
    const res = await call(`/v1/devices/${HASH.toUpperCase()}`, readOnly.key)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      deviceHash: HASH, owner: G, escrowBalance: '123',
      policy: { agent: G, maxAmount: '50000000', asset: C, expiresAt: null },
    })
  })
  it('404s an unknown device and 400s a bad hash', async () => {
    expect((await call(`/v1/devices/${'cd'.repeat(32)}`, readOnly.key)).status).toBe(404)
    expect((await call('/v1/devices/xyz', readOnly.key)).status).toBe(400)
  })
  it('checks a payment', async () => {
    const res = await post('/v1/payments/check', readOnly.key, { deviceHash: HASH, agent: G, asset: C, amount: '60000000' })
    expect(await res.json()).toEqual({ ok: false, reason: 'over_limit' })
  })
  it('refuses float amounts', async () => {
    const res = await post('/v1/payments/check', readOnly.key, { deviceHash: HASH, agent: G, asset: C, amount: 1.5 })
    expect(res.status).toBe(400)
  })
  it('answers CORS only for allowed origins', async () => {
    const ok = await call('/v1/network', readOnly.key, { headers: { Origin: 'https://shop.example' } })
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://shop.example')
    const no = await call('/v1/network', readOnly.key, { headers: { Origin: 'https://evil.example' } })
    expect(no.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('transactions', () => {
  it('prepares an unsigned transaction from JSON', async () => {
    const res = await post('/v1/transactions/prepare', full.key, {
      source: G, operation: { kind: 'registerAgent', deviceHash: HASH, agent: G, asset: C, maxAmount: '5', expiresAt: '2030-01-01T00:00:00Z' },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).xdr).toBe('AAAA-unsigned')
    const last = prepared.at(-1)!
    expect(last.op).toMatchObject({ kind: 'registerAgent', maxAmount: 5n })
  })
  it('rejects an unknown operation kind', async () => {
    const res = await post('/v1/transactions/prepare', full.key, { source: G, operation: { kind: 'drain' } })
    expect(res.status).toBe(400)
  })
  it('maps contract refusals to 422 with the contract error name', async () => {
    const res = await post('/v1/transactions/submit', full.key, { xdr: 'refused-xdr-envelope' })
    expect(res.status).toBe(422)
    expect((await res.json()).error.contractError).toBe('DuplicateAuth')
  })
})

describe('webhooks', () => {
  it('creates, lists (without secret) and deletes per key', async () => {
    const created = await (await post('/v1/webhooks', full.key, { url: 'https://hooks.example/noir', types: ['payment.authorized'] })).json()
    expect(created.secret).toMatch(/^whsec_/)
    const listed = await (await call('/v1/webhooks', full.key)).json()
    expect(listed.webhooks).toHaveLength(1)
    expect(listed.webhooks[0].secret).toBeUndefined()

    expect((await call('/v1/webhooks', other.key).then((r) => r.json())).webhooks).toHaveLength(0)
    expect((await call(`/v1/webhooks/${created.id}`, other.key, { method: 'DELETE' })).status).toBe(404)
    expect((await call(`/v1/webhooks/${created.id}`, full.key, { method: 'DELETE' })).status).toBe(200)
  })
  it('rejects unknown event types', async () => {
    expect((await post('/v1/webhooks', full.key, { url: 'https://hooks.example/x', types: ['payment.stolen'] })).status).toBe(400)
  })
  it('refuses private and insecure targets', () => {
    expect(checkWebhookUrl('http://hooks.example/x', false)).toMatch(/https/)
    for (const u of ['https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest', 'https://[::1]/x']) {
      expect(checkWebhookUrl(u, false)).toMatch(/publicly reachable/)
    }
    expect(checkWebhookUrl('https://hooks.example/x', false)).toBeNull()
  })
})
