// Playwright UI harness for the Noir Expo react-native-web build.
// Boots the web dev server, seeds a wallet + devices + agents into localStorage
// (so agents self-heal from the persisted device list on login), then navigates
// each screen and screenshots it for visual review.
const { chromium } = require('playwright')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const { buildSeed } = require('./seed')

const PORT = 8091
const BASE = `http://localhost:${PORT}`
const OUT = path.join(__dirname, 'shots')
fs.mkdirSync(OUT, { recursive: true })

function waitForServer(url, timeoutMs = 120000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url)
        if (res.ok) return resolve(true)
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('server timeout'))
      setTimeout(tick, 1500)
    }
    tick()
  })
}

const ROUTES = [
  { name: '01-dashboard', path: '/' },
  { name: '02-agents', path: '/pos' },       // Agents tab
  { name: '03-devices', path: '/devices' },
  { name: '04-send', path: '/send' },
  { name: '05-receive', path: '/receive' },
  { name: '06-settings', path: '/settings' },
  { name: '07-security', path: '/security' },
  { name: '08-provisioning', path: '/device-provisioning' },
]

;(async () => {
  console.log('› Starting Expo web server…')
  const server = spawn('npx', ['expo', 'start', '--web', '--port', String(PORT)], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, CI: '1', BROWSER: 'none' },
    stdio: 'ignore',
  })

  const cleanup = () => { try { server.kill('SIGTERM') } catch {} }
  process.on('exit', cleanup)

  try {
    await waitForServer(BASE)
    console.log('› Web server up. Launching browser…')

    const seed = await buildSeed()
    const browser = await chromium.launch()
    const context = await browser.newContext({
      viewport: { width: 414, height: 896 }, // iPhone 11-ish portrait
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
    page.on('pageerror', (e) => consoleErrors.push(e.message))

    // 1. First load to obtain the runtime store-version hash (contract-ID based).
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000) // let the bundle boot
    const storeVersion = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('noir-wallet')
        return raw ? (JSON.parse(raw).state?.storeVersion ?? null) : null
      } catch { return null }
    })
    console.log('› Runtime storeVersion:', storeVersion)

    // 2. Seed wallet keys + agent secrets + persisted store into localStorage.
    await page.evaluate(({ seed, storeVersion }) => {
      localStorage.setItem('wallet_keys', JSON.stringify(seed.walletKeys))
      const store = seed.persistedStore
      store.state.storeVersion = storeVersion || store.state.storeVersion
      localStorage.setItem('noir-wallet', JSON.stringify(store))
      // Intentionally DO NOT seed x402.agent.* keys — this reproduces the
      // "no agents after login" state and lets syncAgentsFromDevices self-heal.
    }, { seed, storeVersion })

    // 3. Reload so the app rehydrates from the seeded state.
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    // Wait past the splash + hydration gate, then confirm we landed in the tabs.
    await page.waitForTimeout(9000)
    console.log('› url after boot:', page.url())
    await page.screenshot({ path: path.join(OUT, '01-dashboard.png') })
    console.log('  ✓ shot 01-dashboard')

    // Tab labels render with CSS uppercase but DOM text is title-case.
    const tabs = [
      { name: '02-agents', label: 'Agents' },
      { name: '03-devices', label: 'Devices' },
      { name: '06-settings', label: 'Settings' },
    ]
    for (const tab of tabs) {
      try {
        const el = page.getByText(tab.label, { exact: true }).last()
        await el.click({ timeout: 8000 })
        await page.waitForTimeout(3000)
        await page.screenshot({ path: path.join(OUT, tab.name + '.png') })
        console.log('  ✓ shot', tab.name)
      } catch (e) {
        console.log('  ✗ tab failed', tab.name, e.message.split('\n')[0])
      }
    }

    // Agent detail — Agents tab, then the first device row.
    try {
      await page.getByText('Agents', { exact: true }).last().click({ timeout: 8000 })
      await page.waitForTimeout(2500)
      await page.getByText('Blue Keychain', { exact: true }).last().click({ timeout: 8000 })
      await page.waitForTimeout(3000)
      await page.screenshot({ path: path.join(OUT, '10-agent-detail.png') })
      console.log('  ✓ shot 10-agent-detail')
    } catch (e) {
      console.log('  ✗ agent-detail failed', e.message.split('\n')[0])
    }

    // Export Keys screen (direct route) + Profile (KYC removed).
    for (const r of [
      { name: '11-export-keys', path: '/settings/export-keys' },
      { name: '12-profile', path: '/profile' },
      { name: '13-security', path: '/settings/security' },
    ]) {
      try {
        await page.goto(BASE + r.path, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(3500)
        await page.screenshot({ path: path.join(OUT, r.name + '.png') })
        console.log('  \u2713 shot', r.name)
      } catch (e) {
        console.log('  \u2717 failed', r.name, e.message.split('\n')[0])
      }
    }

    // Verify agents self-healed: read the x402 index from localStorage.
    const healed = await page.evaluate(() => {
      const raw = localStorage.getItem('x402.agents.index')
      return raw ? JSON.parse(raw) : null
    })
    console.log('› x402.agents.index after load:', JSON.stringify(healed))
    console.log('› console errors:', consoleErrors.length ? consoleErrors.slice(0, 8) : 'none')

    await browser.close()
    console.log('› Done. Screenshots in', OUT)
  } finally {
    cleanup()
  }
})().catch((e) => { console.error(e); process.exit(1) })
