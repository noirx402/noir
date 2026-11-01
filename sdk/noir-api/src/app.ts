import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  NoirContractError, normalizeDeviceHash,
  type NoirAgentClient, type NoirOperation, type NoirEventType,
} from '@noirx402/agent-sdk'
import { presentedKey, type ApiKeyRecord, type KeyStore, type Scope } from './keys.js'
import type { RateLimiter } from './ratelimit.js'
import { checkWebhookUrl, isEventType, type WebhookHub } from './webhooks.js'

export type NoirApiClient = Pick<NoirAgentClient,
  'config' | 'getPolicy' | 'getDeviceOwner' | 'getEscrowBalance' | 'getPendingBalance' | 'listDevices' |
  'checkPayment' | 'prepare' | 'submit' | 'getEvents'>

export interface AppOptions {
  client: NoirApiClient
  keys: KeyStore
  limiter: RateLimiter
  hub: WebhookHub
  /** Requests per minute for keys that don't set their own. */
  defaultRateLimit: number
  corsOrigins?: string[]
  allowInsecureWebhooks?: boolean
}

const MAX_BODY = 64 * 1024

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}
const bad = (message: string) => new HttpError(400, 'invalid_request', message)

interface Ctx { key: ApiKeyRecord; params: string[]; query: URLSearchParams; body: () => Promise<Record<string, unknown>> }
type Handler = (ctx: Ctx) => Promise<unknown>
interface Route { method: string; pattern: RegExp; scope: Scope; handler: Handler }

const ADDRESS = /^[GC][A-Z2-7]{55}$/
const account = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !ADDRESS.test(v)) throw bad(`${field} must be a Stellar address (G… or C…)`)
  return v
}
const device = (v: unknown, field = 'deviceHash'): string => {
  try { return normalizeDeviceHash(String(v ?? '')) } catch { throw bad(`${field} must be 64 hex characters`) }
}
/** Amounts travel as decimal strings in the asset's smallest unit (stroops for XLM), never floats. */
const amount = (v: unknown, field = 'amount'): bigint => {
  if (typeof v === 'string' && /^\d{1,38}$/.test(v)) return BigInt(v)
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v)
  throw bad(`${field} must be a non-negative integer string in the asset's smallest unit`)
}

function operation(raw: unknown): NoirOperation {
  if (!raw || typeof raw !== 'object') throw bad('operation is required')
  const o = raw as Record<string, unknown>
  switch (o.kind) {
    case 'authorize':
      return {
        kind: 'authorize', deviceHash: device(o.deviceHash), merchant: account(o.merchant, 'merchant'),
        asset: account(o.asset, 'asset'), amount: amount(o.amount),
        nonce: o.nonce === undefined ? BigInt(Date.now()) : amount(o.nonce, 'nonce'),
      }
    case 'claim':
      return { kind: 'claim', token: account(o.token, 'token') }
    case 'registerAgent': {
      let expiresAt: Date | null = null
      if (o.expiresAt !== undefined && o.expiresAt !== null) {
        expiresAt = new Date(typeof o.expiresAt === 'number' ? o.expiresAt * 1000 : String(o.expiresAt))
        if (Number.isNaN(expiresAt.getTime())) throw bad('expiresAt must be an ISO date or unix seconds')
      }
      return {
        kind: 'registerAgent', deviceHash: device(o.deviceHash), agent: account(o.agent, 'agent'),
        asset: account(o.asset, 'asset'), maxAmount: amount(o.maxAmount, 'maxAmount'), expiresAt,
      }
    }
    case 'revokeAgent':
      return { kind: 'revokeAgent', deviceHash: device(o.deviceHash) }
    case 'fundEscrow':
    case 'defundEscrow':
      return { kind: o.kind, deviceHash: device(o.deviceHash), token: account(o.token, 'token'), amount: amount(o.amount) }
    default:
      throw bad('operation.kind must be one of authorize, claim, registerAgent, revokeAgent, fundEscrow, defundEscrow')
  }
}

function routes(o: AppOptions): Route[] {
  const { client, hub } = o
  const r = (method: string, path: string, scope: Scope, handler: Handler): Route =>
    ({ method, scope, handler, pattern: new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`) })

  return [
    r('GET', '/v1/network', 'read', async () => ({
      rpcUrl: client.config.rpcUrl,
      networkPassphrase: client.config.networkPassphrase,
      contracts: client.config.contracts,
    })),

    r('GET', '/v1/devices/:hash', 'read', async ({ params }) => {
      const hash = device(params[0], 'device hash')
      const [owner, policy, escrowBalance] = await Promise.all([
        client.getDeviceOwner(hash), client.getPolicy(hash), client.getEscrowBalance(hash),
      ])
      if (!owner) throw new HttpError(404, 'device_not_found', 'No Noir device is registered with this hash')
      return { deviceHash: hash, owner, policy, escrowBalance }
    }),

    r('GET', '/v1/devices/:hash/policy', 'read', async ({ params }) => {
      const policy = await client.getPolicy(device(params[0], 'device hash'))
      if (!policy) throw new HttpError(404, 'agent_not_found', 'No agent policy for this device')
      return policy
    }),

    r('GET', '/v1/wallets/:address/devices', 'read', async ({ params }) =>
      ({ devices: await client.listDevices(account(params[0], 'address')) })),

    r('GET', '/v1/merchants/:address/pending', 'read', async ({ params }) =>
      ({ pending: await client.getPendingBalance(account(params[0], 'address')) })),

    r('POST', '/v1/payments/check', 'read', async ({ body }) => {
      const b = await body()
      return client.checkPayment({
        deviceHash: device(b.deviceHash), agent: account(b.agent, 'agent'),
        asset: account(b.asset, 'asset'), amount: amount(b.amount),
        ...(b.requireEscrow === false ? { requireEscrow: false } : {}),
      })
    }),

    r('GET', '/v1/events', 'read', async ({ query }) => {
      const limit = query.has('limit') ? Number(query.get('limit')) : undefined
      if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 200)) throw bad('limit must be 1-200')
      const cursor = query.get('cursor') ?? undefined
      const from = query.get('fromLedger')
      const startLedger = from === null ? undefined : Number(from)
      if (startLedger !== undefined && !(Number.isInteger(startLedger) && startLedger > 0)) throw bad('fromLedger must be a ledger number')
      return client.getEvents({ cursor, startLedger, limit })
    }),

    r('POST', '/v1/transactions/prepare', 'write', async ({ body }) => {
      const b = await body()
      const op = operation(b.operation)
      const xdr = await client.prepare(account(b.source, 'source'), op)
      return { xdr, networkPassphrase: client.config.networkPassphrase, operation: op }
    }),

    r('POST', '/v1/transactions/submit', 'write', async ({ body }) => {
      const b = await body()
      if (typeof b.xdr !== 'string' || b.xdr.length < 16) throw bad('xdr must be a signed transaction envelope (base64)')
      return { hash: await client.submit(b.xdr) }
    }),

    r('POST', '/v1/webhooks', 'webhooks', async ({ key, body }) => {
      const b = await body()
      if (typeof b.url !== 'string') throw bad('url is required')
      const urlErr = checkWebhookUrl(b.url, !!o.allowInsecureWebhooks)
      if (urlErr) throw bad(urlErr)
      let types: NoirEventType[] | undefined
      if (b.types !== undefined) {
        if (!Array.isArray(b.types) || !b.types.every(isEventType)) throw bad('types must be a list of Noir event types')
        types = b.types
      }
      const sub = hub.create(key.id, {
        url: b.url, types,
        deviceHash: b.deviceHash === undefined ? undefined : device(b.deviceHash),
        merchant: b.merchant === undefined ? undefined : account(b.merchant, 'merchant'),
      })
      const { keyId: _k, ...out } = sub
      return out // the only time the secret is shown
    }),

    r('GET', '/v1/webhooks', 'webhooks', async ({ key }) => ({ webhooks: hub.list(key.id) })),

    r('DELETE', '/v1/webhooks/:id', 'webhooks', async ({ key, params }) => {
      if (!hub.remove(key.id, params[0])) throw new HttpError(404, 'not_found', 'No such webhook')
      return { deleted: true }
    }),
  ]
}

function send(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { reject(new HttpError(413, 'payload_too_large', 'Body over 64 KB')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      if (size === 0) return resolve({})
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error()
        resolve(v)
      } catch { reject(bad('Body must be a JSON object')) }
    })
    req.on('error', reject)
  })
}

/** The request handler. Pass it to `http.createServer`. */
export function createApp(o: AppOptions) {
  const table = routes(o)
  const cors = new Set(o.corsOrigins ?? [])

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://noir.local')
    const origin = req.headers.origin
    const corsHeaders: Record<string, string> = origin && cors.has(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {}

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE',
        'Access-Control-Allow-Headers': 'Authorization, X-API-Key, Content-Type',
        'Access-Control-Max-Age': '600',
      })
      return res.end()
    }

    if (url.pathname === '/v1/health') return send(res, 200, { ok: true }, corsHeaders)

    const matching = table.filter((rt) => rt.pattern.test(url.pathname))
    if (matching.length === 0) return send(res, 404, { error: { code: 'not_found', message: 'No such endpoint' } }, corsHeaders)
    const route = matching.find((rt) => rt.method === req.method)
    if (!route) return send(res, 405, { error: { code: 'method_not_allowed', message: `Use ${matching.map((m) => m.method).join(', ')}` } }, corsHeaders)

    const key = o.keys.verify(presentedKey(req.headers))
    if (!key) {
      return send(res, 401, { error: { code: 'unauthorized', message: 'Send a valid API key as "Authorization: Bearer noir_sk_…"' } },
        { ...corsHeaders, 'WWW-Authenticate': 'Bearer' })
    }
    if (!key.scopes.includes(route.scope)) {
      return send(res, 403, { error: { code: 'insufficient_scope', message: `This key lacks the "${route.scope}" scope` } }, corsHeaders)
    }

    const limit = key.rateLimit ?? o.defaultRateLimit
    const rl = o.limiter.take(key.id, limit)
    const rlHeaders = { ...corsHeaders, 'X-RateLimit-Limit': String(limit), 'X-RateLimit-Remaining': String(rl.remaining) }
    if (!rl.ok) {
      return send(res, 429, { error: { code: 'rate_limited', message: 'Too many requests' } },
        { ...rlHeaders, 'Retry-After': String(rl.retryAfterSec) })
    }

    try {
      const params = route.pattern.exec(url.pathname)!.slice(1).map(decodeURIComponent)
      const data = await route.handler({ key, params, query: url.searchParams, body: () => readBody(req) })
      send(res, 200, data, rlHeaders)
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } }, rlHeaders)
      if (e instanceof NoirContractError) {
        return send(res, 422, { error: { code: 'contract_refused', contractError: e.errorName, message: e.message } }, rlHeaders)
      }
      send(res, 502, { error: { code: 'upstream_error', message: String((e as Error)?.message ?? e) } }, rlHeaders)
    }
  }
}
