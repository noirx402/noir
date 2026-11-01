import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { isIP } from 'node:net'
import {
  eventToJSON, normalizeDeviceHash, signWebhookBody, NOIR_EVENT_TYPES, SIGNATURE_HEADER,
  type NoirAgentClient, type NoirEvent, type NoirEventType,
} from '@noirx402/agent-sdk'

export interface Subscription {
  id: string
  /** API key that created it; only that key can list or delete it. */
  keyId: string
  url: string
  /** HMAC secret for X-Noir-Signature. Returned once, at creation. */
  secret: string
  types?: NoirEventType[]
  deviceHash?: string
  merchant?: string
  createdAt: string
}

export type PublicSubscription = Omit<Subscription, 'secret' | 'keyId'>

const RETRIES = 4
const BACKOFF_MS = 1000

/** Rejects webhook targets that would point the gateway at itself or a private network. */
export function checkWebhookUrl(raw: string, allowInsecure: boolean): string | null {
  let u: URL
  try { u = new URL(raw) } catch { return 'url must be an absolute URL' }
  if (allowInsecure) return u.protocol === 'https:' || u.protocol === 'http:' ? null : 'url must be http(s)'
  if (u.protocol !== 'https:') return 'url must use https'
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return 'url must be publicly reachable'
  }
  if (isIP(host) && isPrivateIp(host)) return 'url must be publicly reachable'
  return null
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes(':')) return ip === '::1' || ip === '::' || /^f[cd]/.test(ip) || /^fe80/.test(ip) || ip.startsWith('::ffff:')
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

/**
 * Holds webhook subscriptions and runs one shared event watcher for all of
 * them, so N subscribers cost one RPC poll, not N. Delivery is at-least-once
 * with exponential backoff; receivers dedupe on `event.id`.
 */
export class WebhookHub {
  private subs = new Map<string, Subscription>()
  private stop?: () => void

  constructor(
    private client: Pick<NoirAgentClient, 'watch'>,
    private opts: { file?: string; fetchImpl?: typeof fetch; log?: (msg: string) => void } = {},
  ) {
    if (opts.file && existsSync(opts.file)) {
      for (const s of JSON.parse(readFileSync(opts.file, 'utf8')) as Subscription[]) this.subs.set(s.id, s)
    }
  }

  start() {
    if (this.stop) return
    this.stop = this.client.watch({
      onEvent: (e) => { for (const s of this.subs.values()) if (matches(s, e)) void this.deliver(s, e) },
      onError: (err) => this.opts.log?.(`webhook watcher: ${String((err as Error)?.message ?? err)}`),
    })
  }

  close() { this.stop?.(); this.stop = undefined }

  create(keyId: string, input: { url: string; types?: NoirEventType[]; deviceHash?: string; merchant?: string }): Subscription {
    const sub: Subscription = {
      id: `wh_${randomBytes(8).toString('hex')}`,
      keyId,
      url: input.url,
      secret: `whsec_${randomBytes(32).toString('base64url')}`,
      ...(input.types?.length ? { types: input.types } : {}),
      ...(input.deviceHash ? { deviceHash: normalizeDeviceHash(input.deviceHash) } : {}),
      ...(input.merchant ? { merchant: input.merchant } : {}),
      createdAt: new Date().toISOString(),
    }
    this.subs.set(sub.id, sub)
    this.persist()
    return sub
  }

  list(keyId: string): PublicSubscription[] {
    return [...this.subs.values()].filter((s) => s.keyId === keyId).map(toPublic)
  }

  remove(keyId: string, id: string): boolean {
    const s = this.subs.get(id)
    if (!s || s.keyId !== keyId) return false
    this.subs.delete(id)
    this.persist()
    return true
  }

  private persist() {
    if (this.opts.file) writeFileSync(this.opts.file, JSON.stringify([...this.subs.values()], null, 2), { mode: 0o600 })
  }

  private async deliver(s: Subscription, e: NoirEvent) {
    const doFetch = this.opts.fetchImpl ?? fetch
    const body = JSON.stringify({ subscription: s.id, event: eventToJSON(e) })
    for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
      if (!this.subs.has(s.id)) return // deleted mid-retry
      try {
        const res = await doFetch(s.url, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
          headers: { 'Content-Type': 'application/json', [SIGNATURE_HEADER]: await signWebhookBody(s.secret, body) },
          body,
        })
        if (res.ok) return
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break
      } catch { /* network error: retry */ }
      if (attempt <= RETRIES) await new Promise((r) => setTimeout(r, BACKOFF_MS * 2 ** (attempt - 1)))
    }
    this.opts.log?.(`webhook ${s.id}: gave up on ${e.id}`)
  }
}

export function isEventType(t: unknown): t is NoirEventType {
  return typeof t === 'string' && (NOIR_EVENT_TYPES as readonly string[]).includes(t)
}

function matches(s: Subscription, e: NoirEvent): boolean {
  return (!s.types || s.types.includes(e.type)) &&
    (!s.deviceHash || ('deviceHash' in e && e.deviceHash === s.deviceHash)) &&
    (!s.merchant || ('merchant' in e && e.merchant === s.merchant))
}

const toPublic = ({ secret: _s, keyId: _k, ...pub }: Subscription): PublicSubscription => pub
