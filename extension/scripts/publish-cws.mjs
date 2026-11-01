#!/usr/bin/env node
// Uploads the packaged extension to the Chrome Web Store and submits it for
// review, through the Chrome Web Store API v2.
//
//   npm run release            # typecheck, tests, e2e, zip
//   npm run publish:cws        # upload + submit for review
//   npm run publish:cws -- --upload-only   # upload a draft, submit from the dashboard
//   npm run publish:cws -- --dry-run       # check config and package, no network
//
// Needs, from the Google account that owns the item:
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN  (OAuth, scope .../auth/chromewebstore)
//   CWS_PUBLISHER_ID  (Developer Dashboard → Publisher → Settings)
//   CWS_EXTENSION_ID  (the item's 32-letter ID)
// The very first submission (listing text, graphics, privacy tab) is made in
// the dashboard: see store/LISTING.md. Every release after that goes through here.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const r = (p) => fileURLToPath(new URL(p, import.meta.url))
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const uploadOnly = args.has('--upload-only')

const API = 'https://chromewebstore.googleapis.com'
const ENV = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID']

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

const manifest = JSON.parse(await readFile(r('../manifest.json'), 'utf8'))
const pkg = JSON.parse(await readFile(r('../package.json'), 'utf8'))
if (manifest.version !== pkg.version) fail(`manifest.json is ${manifest.version} but package.json is ${pkg.version}; bump both`)

const zipPath = r(`../noir-wallet-extension-${pkg.version}.zip`)
const zip = await readFile(zipPath).catch(() => fail(`${zipPath} not found; run npm run release first`))
console.log(`• package ${zipPath} (${(zip.length / 1024).toFixed(0)} KB), version ${pkg.version}`)

const missing = ENV.filter((k) => !process.env[k])
if (missing.length) fail(`missing ${missing.join(', ')} (see the header of scripts/publish-cws.mjs)`)
if (!/^[a-p]{32}$/.test(process.env.CWS_EXTENSION_ID)) fail('CWS_EXTENSION_ID must be the 32-letter item ID')
if (dryRun) { console.log('✓ dry run: config and package look right; nothing sent'); process.exit(0) }

const env = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
const item = `${API}/v2/publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`

async function call(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  const body = text ? JSON.parse(text) : {}
  if (!res.ok) fail(`${init?.method ?? 'GET'} ${url} → HTTP ${res.status}: ${text}`)
  return body
}

const { access_token: token } = await call('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: env.CWS_CLIENT_ID, client_secret: env.CWS_CLIENT_SECRET,
    refresh_token: env.CWS_REFRESH_TOKEN, grant_type: 'refresh_token',
  }),
})
const auth = { Authorization: `Bearer ${token}` }

console.log('• uploading')
let upload = await call(`${API}/upload/v2/publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}:upload`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/zip' }, body: zip,
})
for (let i = 0; upload.uploadState === 'UPLOAD_IN_PROGRESS' || upload.lastAsyncUploadState === 'IN_PROGRESS'; i++) {
  if (i >= 30) fail('upload still processing after 5 minutes; check the dashboard')
  await new Promise((res) => setTimeout(res, 10_000))
  upload = await call(`${item}:fetchStatus`, { headers: auth })
}
const state = upload.uploadState ?? upload.lastAsyncUploadState
if (state && !['SUCCEEDED', 'SUCCESS'].includes(state)) fail(`upload ${state}: ${JSON.stringify(upload)}`)
console.log(`✓ uploaded ${pkg.version}`)

if (uploadOnly) { console.log('• --upload-only: submit it for review from the Developer Dashboard'); process.exit(0) }

const published = await call(`${item}:publish`, { method: 'POST', headers: auth })
console.log(`✓ submitted for review: ${JSON.stringify(published)}`)
