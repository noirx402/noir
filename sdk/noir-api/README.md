# Noir API (`sdk/noir-api`)

A self-hostable REST gateway in front of Noir's Soroban contracts. Apps that
aren't written in JavaScript, or that want **API keys, scopes, rate limits and
managed webhooks**, call this instead of using
[`@noirx402/agent-sdk`](../agent-sdk) directly.

It is **non-custodial**: it never sees a secret key. Writes are two calls:
`prepare` returns an unsigned transaction, your user's wallet (or your agent
key) signs it, and `submit` sends it.

## Run it

```bash
npm run setup                                         # builds the SDK, installs deps
npm run build
npm run keygen -- my-shop --scopes read,write,webhooks
#   → prints noir_sk_xxxxxxxx_… once; only its SHA-256 hash goes in keys.json
npm start                                             # :8787, Noir Testnet by default
```

Configuration is environment variables; see [`.env.example`](.env.example).
To revoke a key, set `"disabled": true` on its record in `keys.json` and restart.

## Authenticate

```bash
curl https://your-noir-api.example/v1/devices/$DEVICE_HASH \
  -H "Authorization: Bearer noir_sk_xxxxxxxx_…"
```

`X-API-Key: noir_sk_…` also works. Keys carry scopes:

| Scope | Allows |
|---|---|
| `read` | network, devices, policies, balances, payment checks, events |
| `write` | `transactions/prepare` and `transactions/submit` |
| `webhooks` | create, list and delete webhook subscriptions |

Every response carries `X-RateLimit-Limit` / `X-RateLimit-Remaining`; over the
limit you get `429` with `Retry-After`.

## Endpoints

Amounts are **decimal strings in the asset's smallest unit** (1 XLM = `"10000000"`).
Device hashes are the 64-hex SHA-256 Noir registers for an NFC tag.

| Method & path | Scope | Returns |
|---|---|---|
| `GET /v1/health` | none | `{ ok: true }` |
| `GET /v1/network` | read | RPC URL, passphrase, contract IDs |
| `GET /v1/devices/:hash` | read | `{ deviceHash, owner, policy, escrowBalance }` or 404 |
| `GET /v1/devices/:hash/policy` | read | `{ agent, maxAmount, asset, expiresAt }` or 404 |
| `GET /v1/wallets/:address/devices` | read | `{ devices: [hash…] }` |
| `GET /v1/merchants/:address/pending` | read | `{ pending }` |
| `POST /v1/payments/check` | read | `{ ok: true }` or `{ ok: false, reason }` |
| `GET /v1/events?fromLedger=&cursor=&limit=` | read | `{ events, cursor, latestLedger }` |
| `POST /v1/transactions/prepare` | write | `{ xdr, networkPassphrase, operation }` |
| `POST /v1/transactions/submit` | write | `{ hash }` once confirmed |
| `POST /v1/webhooks` | webhooks | subscription incl. `secret` (shown once) |
| `GET /v1/webhooks` | webhooks | this key's subscriptions |
| `DELETE /v1/webhooks/:id` | webhooks | `{ deleted: true }` |

### Check, then pay

```bash
curl -X POST $API/v1/payments/check -H "Authorization: Bearer $KEY" \
  -d '{"deviceHash":"…","agent":"G…","asset":"C…","amount":"10000000"}'
# {"ok":false,"reason":"over_limit"}
```

Refusal reasons: `no_agent`, `wrong_agent`, `wrong_asset`, `invalid_amount`,
`over_limit`, `expired`, `insufficient_escrow`.

### Writes: prepare → sign → submit

```bash
curl -X POST $API/v1/transactions/prepare -H "Authorization: Bearer $KEY" -d '{
  "source": "G…agent",
  "operation": { "kind": "authorize", "deviceHash": "…", "merchant": "G…",
                 "asset": "C…", "amount": "10000000" }
}'
# → { "xdr": "AAAA…" }  sign it with the source account, then:
curl -X POST $API/v1/transactions/submit -H "Authorization: Bearer $KEY" -d '{"xdr":"<signed>"}'
```

`operation.kind` is one of `authorize` (agent), `claim` (merchant),
`registerAgent`, `revokeAgent`, `fundEscrow`, `defundEscrow` (device owner).
`source` must be that acting account.

### Webhooks

```bash
curl -X POST $API/v1/webhooks -H "Authorization: Bearer $KEY" \
  -d '{"url":"https://shop.example/noir","types":["payment.authorized"],"merchant":"G…"}'
```

Each delivery is `POST {"subscription":"wh_…","event":{…}}` with
`X-Noir-Signature: t=<unix>,v1=<hmac-sha256>`. Verify it with
`verifyWebhookSignature(secret, rawBody, header)` from the SDK, reject anything
older than 5 minutes, and dedupe on `event.id` (delivery is at-least-once).
Webhook URLs must be public `https://` targets; private and loopback addresses
are refused. All subscriptions share one event watcher.

## Errors

```json
{ "error": { "code": "contract_refused", "contractError": "DuplicateAuth", "message": "…" } }
```

| Status | `code` |
|---|---|
| 400 | `invalid_request` |
| 401 / 403 | `unauthorized` / `insufficient_scope` |
| 404 | `not_found`, `device_not_found`, `agent_not_found` |
| 422 | `contract_refused` (+ `contractError`, the contract's own error name) |
| 429 | `rate_limited` |
| 502 | `upstream_error` (Soroban RPC) |

## Limits

This is a reference gateway: keys live in a JSON file, rate-limit buckets are
in memory (one process), and webhook delivery isn't queued across restarts.
Put it behind TLS. For several replicas, move keys, buckets and subscriptions
to a shared store.

## Develop

```bash
npm test        # 18 tests: auth, scopes, rate limits, validation, webhooks
npm run typecheck
```
