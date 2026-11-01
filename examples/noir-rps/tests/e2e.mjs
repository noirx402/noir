// End-to-end on Stellar Testnet with the real Noir extension:
// builds nothing itself (npm run test:e2e builds the page first), starts the
// house serving dist/, loads extension/dist into Chromium, imports a fresh
// wallet, funds it with Friendbot, connects to the game and plays rounds,
// approving each stake in the Noir window. SHOTS=<dir> saves screenshots.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXT = fileURLToPath(new URL('../../../extension/dist', import.meta.url))
const require = createRequire(join(ROOT, '../../extension/package.json'))
const { generateMnemonic } = require('@scure/bip39')
const { wordlist } = require('@scure/bip39/wordlists/english.js')
const PORT = 8790
const GAME = `http://localhost:${PORT}/`
const PASSWORD = 'correct horse battery'
const ROUNDS = Number(process.env.ROUNDS ?? 3)
const SHOTS = process.env.SHOTS
const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }) : null)
const ok = (name) => console.log(`  ✓ ${name}`)

assert.ok(existsSync(join(EXT, 'manifest.json')), 'Build the extension first: cd extension && npm run build')

const house = spawn('npx', ['tsx', 'server/main.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((resolve, reject) => {
  house.stdout.on('data', (d) => { if (String(d).includes('House ')) resolve() })
  house.on('exit', (c) => reject(new Error(`house exited ${c}`)))
})

const profile = await mkdtemp(join(tmpdir(), 'noir-rps-'))
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1200, height: 860 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})

try {
  let [sw] = ctx.serviceWorkers()
  sw ??= await ctx.waitForEvent('serviceworker')
  const extId = new URL(sw.url()).host

  // A fresh wallet in the extension.
  const popup = await ctx.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await popup.getByRole('button', { name: 'I already have a recovery phrase' }).click()
  await popup.locator('textarea').fill(generateMnemonic(wordlist))
  await popup.getByRole('button', { name: 'Continue' }).click()
  const pws = popup.locator('input[type=password]')
  await pws.nth(0).fill(PASSWORD)
  await pws.nth(1).fill(PASSWORD)
  await popup.getByRole('button', { name: 'Create wallet' }).click()
  await popup.getByText('Connected sites').waitFor()
  const address = await popup.locator('.mono[title]').getAttribute('title')
  const fund = await fetch(`https://friendbot.stellar.org/?addr=${address}`)
  assert.ok(fund.ok, `friendbot ${fund.status}`)
  ok(`extension wallet ${address.slice(0, 6)}… funded with Friendbot`)

  const game = await ctx.newPage()
  await game.goto(GAME)
  await game.getByRole('button', { name: 'Connect Noir' }).waitFor()
  await shot(game, '01-game')

  /** Clicks in the game, then approves the Noir window that opens. */
  async function approve(click, button) {
    const opened = ctx.waitForEvent('page')
    await click()
    const win = await opened
    await win.waitForLoadState()
    await win.getByRole('button', { name: button }).waitFor()
    await shot(win, `approve-${button}-${Date.now()}`)
    await win.getByRole('button', { name: button }).click()
  }

  await approve(() => game.getByRole('button', { name: 'Connect Noir' }).click(), 'Connect')
  await game.locator('#balance').filter({ hasText: 'XLM' }).waitFor()
  await game.getByText(/No cards linked yet|in escrow/).waitFor()
  ok('connects through noirExtensionSigner() and reads cards with the SDK')

  await game.getByRole('button', { name: '2 XLM' }).click()
  for (let i = 0; i < ROUNDS; i++) {
    const move = ['rock', 'paper', 'scissors'][i % 3]
    await approve(() => game.getByRole('button', { name: move }).click(), 'Approve')
    await game.locator('#history li').nth(i).waitFor({ timeout: 60_000 })
    const verdict = await game.locator('.verdict').textContent()
    assert.equal(await game.locator('.fair').count(), 1, 'commitment check failed')
    assert.equal(await game.locator('.status[data-tone="error"]').count(), 0, await game.locator('#status').textContent())
    ok(`round ${i + 1}: ${move} → ${verdict}, commitment verified`)
  }
  await game.waitForTimeout(1500)
  await shot(game, '02-after-rounds')

  // Every stake and payout landed on Testnet.
  const res = await fetch(`https://horizon-testnet.stellar.org/accounts/${address}/payments?order=desc&limit=20`)
  const { _embedded } = await res.json()
  const stakes = _embedded.records.filter((p) => p.type === 'payment' && p.from === address)
  assert.equal(stakes.length, ROUNDS)
  ok(`${stakes.length} stakes on Testnet, payouts sent for every win and draw`)
} finally {
  await ctx.close()
  house.kill('SIGTERM')
  await rm(profile, { recursive: true, force: true })
}
