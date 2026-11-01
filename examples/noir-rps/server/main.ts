// House server: a Testnet account that deals rounds and pays winners.
//   GET  /api/house  → { address, balance }
//   GET  /api/round  → { roundId, commitment, house, minStake, maxStake }
//   POST /api/play   { roundId, txHash } → PlayResult
// With NODE_ENV=production it also serves the built page from dist/.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Keypair } from '@stellar/stellar-sdk'
import { keypairSigner, type NoirSigner } from '@noirx402/agent-sdk'
import { createHouse, HouseError, type HouseChain } from './house.js'
import { buildPayment, friendbot, horizon, NETWORK_PASSPHRASE, submit, xlmBalance } from '../src/stellar.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SECRET_FILE = join(ROOT, '.house-secret')
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.PORT ?? 8787)

/** The house key: HOUSE_SECRET, else .house-secret, else a new Testnet account. */
function loadHouseKey(): Keypair {
  if (process.env.HOUSE_SECRET) return Keypair.fromSecret(process.env.HOUSE_SECRET)
  if (existsSync(SECRET_FILE)) return Keypair.fromSecret(readFileSync(SECRET_FILE, 'utf8').trim())
  const kp = Keypair.random()
  writeFileSync(SECRET_FILE, kp.secret() + '\n', { mode: 0o600 })
  console.log(`New house account saved to ${SECRET_FILE}`)
  return kp
}

async function signed(signer: NoirSigner, xdr: string): Promise<string> {
  const out = await signer.signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE })
  return typeof out === 'string' ? out : out.signedTxXdr
}

export function horizonChain(signer: NoirSigner): HouseChain {
  return {
    address: signer.publicKey,
    async getPayment(txHash) {
      const tx = await horizon.transactions().transaction(txHash).call()
      const ops = await horizon.operations().forTransaction(txHash).limit(10).call()
      return {
        successful: tx.successful,
        memo: tx.memo_type === 'text' ? tx.memo : undefined,
        operations: ops.records.map((op) => {
          const p = op as unknown as { type: string; asset_type?: string; from?: string; to?: string; amount?: string }
          return { type: p.type, assetType: p.asset_type, from: p.from, to: p.to, amount: p.amount }
        }),
      }
    },
    async pay(to, amount, memo) {
      const xdr = await buildPayment({ from: signer.publicKey, to, amount, memo })
      return submit(await signed(signer, xdr))
    },
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 4096) throw new HouseError(413, 'Body too large')
  }
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    throw new HouseError(400, 'Body must be JSON')
  }
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }

async function serveStatic(path: string, res: ServerResponse) {
  const file = normalize(join(DIST, path === '/' ? 'index.html' : path))
  if (!file.startsWith(DIST)) return send(res, 404, { error: 'Not found' })
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    send(res, 404, { error: 'Not found' })
  }
}

const key = loadHouseKey()
if ((await xlmBalance(key.publicKey())) === 0n) {
  console.log('Funding the house with Friendbot…')
  await friendbot(key.publicKey())
}
const house = createHouse(horizonChain(keypairSigner(key.secret())))

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (req.method === 'GET' && pathname === '/api/house') {
      return send(res, 200, { address: house.address, balance: (await xlmBalance(house.address)).toString() })
    }
    if (req.method === 'GET' && pathname === '/api/round') return send(res, 200, await house.newRound())
    if (req.method === 'POST' && pathname === '/api/play') return send(res, 200, await house.play(await readJson(req)))
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' })
    if (process.env.NODE_ENV === 'production' && req.method === 'GET') return serveStatic(pathname, res)
    send(res, 404, { error: 'Not found' })
  } catch (e) {
    if (e instanceof HouseError) return send(res, e.status, { error: e.message })
    console.error(e)
    send(res, 500, { error: 'House error' })
  }
}).listen(PORT, () => console.log(`House ${house.address} on http://localhost:${PORT}`))
