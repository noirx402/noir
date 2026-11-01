// End-to-end: loads dist/ into Chromium, onboards with the SEP-5 test phrase,
// then drives connect + every signing method from a dApp page and verifies
// the signatures. Run: npm run test:e2e
import { chromium } from 'playwright'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import qrcode from 'qrcode-generator'
import {
  Account, Address, Asset, hash, Keypair, Networks, nativeToScVal, Operation, TransactionBuilder, xdr,
} from '@stellar/stellar-sdk'

const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const MNEMONIC = 'illness spike retreat truth genius clock brain pass fit cave bargain toe'
const ADDRESS = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6'
const PASSWORD = 'correct horse battery'
const ok = (name) => console.log(`  ✓ ${name}`)
const SHOTS = process.env.SHOTS
const shot = (page, name) => (SHOTS ? page.screenshot({ path: join(SHOTS, `${name}.png`) }) : null)

const randomUid = () => `04${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('')}`.toUpperCase()

/** A PNG of a QR code for `text`, drawn by Chromium from qrcode-generator's SVG. */
async function qrPng(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make()
  const page = await ctx.newPage()
  await page.setContent(`<body style="margin:0;background:#fff">${q.createSvgTag({ cellSize: 6, margin: 4 })}</body>`)
  const buf = await page.locator('svg').screenshot()
  await page.close()
  return buf
}

const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>dApp</title><h1>Test dApp</h1>') })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const DAPP = `http://localhost:${server.address().port}/`

const profile = await mkdtemp(join(tmpdir(), 'noir-ext-'))
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
})

try {
  let [sw] = ctx.serviceWorkers()
  sw ??= await ctx.waitForEvent('serviceworker')
  const extId = new URL(sw.url()).host
  const popup = await ctx.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)

  // Import the SEP-5 test phrase.
  await popup.setViewportSize({ width: 360, height: 600 })
  await shot(popup, '01-welcome')
  await popup.getByRole('button', { name: 'I already have a recovery phrase' }).click()
  await popup.locator('textarea').fill(MNEMONIC)
  await popup.getByRole('button', { name: 'Continue' }).click()
  const pws = popup.locator('input[type=password]')
  await pws.nth(0).fill(PASSWORD)
  await pws.nth(1).fill(PASSWORD)
  await popup.getByRole('button', { name: 'Create wallet' }).click()
  await popup.getByText('Recent activity').waitFor()
  assert.equal(await popup.locator('.mono[title]').getAttribute('title'), ADDRESS)
  await popup.waitForTimeout(2500)
  await shot(popup, '02-home')
  ok('imports a recovery phrase into the SEP-5 address')

  const dapp = await ctx.newPage()
  await dapp.goto(DAPP)
  assert.equal(await dapp.evaluate(() => !!window.noir?.stellar?.isNoir), true)
  ok('injects window.noir.stellar')

  /** Runs `fn` in the dApp, answers the approval window, returns the result. */
  async function withApproval(fn, arg, button) {
    const approvalOpened = ctx.waitForEvent('page')
    const result = dapp.evaluate(fn, arg)
    const win = await approvalOpened
    await win.waitForLoadState()
    await win.getByRole('button', { name: button }).waitFor()
    await shot(win, `approve-${button}-${Date.now()}`)
    await win.getByRole('button', { name: button }).click()
    return result
  }

  assert.deepEqual(await dapp.evaluate(() => window.noir.stellar.getNetwork()), { network: 'TESTNET', networkPassphrase: Networks.TESTNET })
  const early = await dapp.evaluate(() => window.noir.stellar.signMessage('hi'))
  assert.match(early.error.message, /not connected/)
  ok('refuses to sign for a site that has not connected')

  const rejected = await withApproval(() => window.noir.stellar.requestAccess(), null, 'Reject')
  assert.equal(rejected.error.code, -4)
  ok('reports a rejected connection as code -4')

  const access = await withApproval(() => window.noir.stellar.requestAccess(), null, 'Connect')
  assert.deepEqual(access, { address: ADDRESS })
  assert.deepEqual(await dapp.evaluate(() => window.noir.stellar.getAddress()), { address: ADDRESS })
  ok('connects after approval; later getAddress needs no prompt')

  const kp = Keypair.fromPublicKey(ADDRESS)
  const msg = await withApproval((m) => window.noir.stellar.signMessage(m), 'Hello, World!', 'Approve')
  const msgHash = hash(Buffer.concat([Buffer.from('Stellar Signed Message:\n'), Buffer.from('Hello, World!')]))
  assert.equal(kp.verify(msgHash, Buffer.from(msg.signedMessage, 'base64')), true)
  assert.equal(msg.signerAddress, ADDRESS)
  ok('signMessage returns a valid SEP-53 signature')

  const tx = new TransactionBuilder(new Account(ADDRESS, '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(300).build()
  const signedTx = await withApproval(([x, p]) => window.noir.stellar.signTransaction(x, { networkPassphrase: p }), [tx.toXDR(), Networks.TESTNET], 'Approve')
  const parsed = TransactionBuilder.fromXDR(signedTx.signedTxXdr, Networks.TESTNET)
  assert.equal(kp.verify(parsed.hash(), parsed.signatures[0].signature()), true)
  ok('signTransaction signs the envelope')

  const wrongNet = await dapp.evaluate(([x, p]) => window.noir.stellar.signTransaction(x, { networkPassphrase: p }), [tx.toXDR(), Networks.PUBLIC])
  assert.equal(wrongNet.error.code, -3)
  ok('refuses a different network without prompting')

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(new xdr.HashIdPreimageSorobanAuthorization({
    networkId: hash(Buffer.from(Networks.TESTNET)), nonce: xdr.Int64.fromString('1'), signatureExpirationLedger: 100,
    invocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
        contractAddress: new Address('CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS').toScAddress(),
        functionName: 'authorize', args: [nativeToScVal(5n, { type: 'i128' })],
      })),
      subInvocations: [],
    }),
  })).toXDR('base64')
  const auth = await withApproval((e) => window.noir.stellar.signAuthEntry(e), preimage, 'Approve')
  assert.equal(kp.verify(hash(Buffer.from(preimage, 'base64')), Buffer.from(auth.signedAuthEntry, 'base64')), true)
  ok('signAuthEntry signs sha256(preimage)')

  // The Stellar Wallets Kit module (kit-module/noir.module.ts) against the real extension.
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('../kit-module/noir.module.ts', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'NoirKit',
    plugins: [{ name: 'kit-types', setup(b) { b.onResolve({ filter: /types\/mod\.ts$/ }, () => ({ path: fileURLToPath(new URL('./fixtures/kit-types.ts', import.meta.url)) })) } }],
  })
  await dapp.addScriptTag({ content: bundled.outputFiles[0].text })
  const viaKit = await dapp.evaluate(async () => {
    const m = new window.NoirKit.NoirModule()
    return { available: await m.isAvailable(), address: (await m.getAddress()).address, network: await m.getNetwork() }
  })
  assert.deepEqual(viaKit, { available: true, address: ADDRESS, network: { network: 'TESTNET', networkPassphrase: Networks.TESTNET } })
  const kitReject = await withApproval(() => new window.NoirKit.NoirModule().signMessage('kit').catch((e) => e), null, 'Reject')
  assert.equal(kitReject.code, -4)
  ok('Stellar Wallets Kit NoirModule works against the extension')

  // The wallet screens the app has: receive, send, cards, agents, activity, settings.
  const tab = (name) => popup.locator('nav.tabs').getByRole('button', { name, exact: true }).click()
  await popup.reload()
  await tab('Wallet')
  await popup.getByRole('button', { name: 'Receive' }).click()
  await popup.locator('svg[aria-label="QR code"]').waitFor()
  await popup.getByLabel('Requested amount in XLM').fill('2.5')
  assert.match(await popup.locator('p.mono.small').textContent(), new RegExp(`^web\\+stellar:pay\\?destination=${ADDRESS}&amount=2\\.5$`))
  await shot(popup, '03-receive')
  await popup.getByRole('button', { name: 'Back' }).click()
  ok('receive shows a SEP-7 QR with the requested amount')

  await popup.getByRole('button', { name: 'Send' }).click()
  await popup.getByLabel('Recipient').fill('not-an-address')
  await popup.getByLabel('Amount in XLM').fill('1')
  await popup.getByRole('button', { name: 'Review' }).click()
  await popup.getByText('Enter a Stellar address that starts with G.').waitFor()
  await popup.getByLabel('Recipient').fill(`web+stellar:pay?destination=${Keypair.random().publicKey()}&amount=3&memo=lunch`)
  assert.equal(await popup.getByLabel('Amount in XLM').inputValue(), '3')
  assert.equal(await popup.getByLabel('Memo').inputValue(), 'lunch')
  await shot(popup, '04-send')
  await popup.getByRole('button', { name: 'Cancel' }).click()
  ok('send validates the address and fills in from a payment link')

  await tab('Cards')
  await popup.getByRole('heading', { name: 'Noir cards' }).waitFor()
  await popup.getByRole('button', { name: 'Link a card' }).first().click()
  await popup.getByRole('radio', { name: 'Daily Carry' }).click()
  await popup.getByRole('button', { name: 'Next' }).click()
  // Desktop Chromium has no Web NFC: the reader screen listens for a USB reader or a typed UID.
  await popup.getByRole('heading', { name: 'Tap the card' }).waitFor()
  await popup.getByText('Phone NFC: not in this browser').waitFor()
  await popup.getByLabel('Card UID').fill('04:zz')
  await popup.getByRole('button', { name: 'Continue' }).click()
  await popup.getByText('A card UID is 4 to 10 bytes of hex').waitFor()
  await shot(popup, '05-link-card')
  // A keyboard-mode USB reader "types" the UID fast and presses Enter; a free card goes on to its policy.
  await popup.getByLabel('Card UID').fill('')
  await popup.getByLabel('Card UID').pressSequentially(randomUid(), { delay: 4 })
  await popup.keyboard.press('Enter')
  await popup.getByRole('heading', { name: 'Agent policy' }).waitFor({ timeout: 30_000 })
  await popup.getByRole('button', { name: 'Cancel' }).click()
  ok('link-a-card reads a UID from a keyboard-mode reader and checks it on Stellar')

  // Pay tab: the app's Tap to pay.
  await tab('Pay')
  await popup.getByRole('heading', { name: 'Tap to pay' }).waitFor()
  await popup.getByLabel('Amount in XLM').fill('1.5')
  await shot(popup, '06b-pay')
  await popup.getByRole('button', { name: 'Tap card' }).click()
  await popup.getByRole('heading', { name: 'Charge 1.5 XLM' }).waitFor()
  await popup.getByLabel('Card UID').fill(randomUid())
  await popup.keyboard.press('Enter')
  await popup.getByText('This card isn’t linked to any Noir wallet.').waitFor({ timeout: 30_000 })
  await shot(popup, '07-charge')
  await popup.getByRole('button', { name: 'Cancel' }).click()
  ok('charge reads a card and refuses one no wallet owns')

  await popup.getByRole('radio', { name: 'Pay by card' }).click()
  assert.equal(await popup.getByLabel('Amount in XLM').inputValue(), '1.5')
  const merchant = Keypair.random().publicKey()
  await popup.getByLabel('Merchant address').fill(`web+stellar:pay?destination=${merchant}&amount=2`)
  assert.equal(await popup.getByLabel('Merchant address').inputValue(), merchant)
  assert.equal(await popup.getByLabel('Amount in XLM').inputValue(), '2')
  await popup.getByLabel('Merchant address').fill(ADDRESS)
  await popup.getByRole('button', { name: 'Tap card' }).click()
  await popup.getByText('That is this wallet’s own address.').waitFor()
  ok('pay by card fills in from a payment link and refuses paying yourself')

  await popup.getByRole('radio', { name: 'QR' }).click()
  await popup.getByLabel('Amount in XLM').fill('2.5')
  await popup.getByRole('button', { name: 'Show QR' }).click()
  await popup.locator('svg[aria-label="QR code"]').waitFor()
  await popup.getByText('Waiting for payment…').waitFor({ timeout: 30_000 })
  await shot(popup, '08-qr-request')
  await popup.getByRole('button', { name: 'Back' }).click()
  ok('QR request shows the code and watches the account')

  // Scan a payment QR from an image into the Send form.
  const qrTo = Keypair.random().publicKey()
  const png = `web+stellar:pay?destination=${qrTo}&amount=4&memo=qr`
  await tab('Wallet')
  await popup.getByRole('button', { name: 'Send' }).click()
  await popup.getByRole('button', { name: 'Scan QR' }).click()
  await popup.getByRole('heading', { name: 'Scan a QR code' }).waitFor()
  await popup.locator('input[type=file]').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: await qrPng(png) })
  await popup.getByRole('heading', { name: 'Send XLM' }).waitFor()
  assert.equal(await popup.getByLabel('Recipient').inputValue(), qrTo)
  assert.equal(await popup.getByLabel('Amount in XLM').inputValue(), '4')
  assert.equal(await popup.getByLabel('Memo').inputValue(), 'qr')
  await popup.getByRole('button', { name: 'Cancel' }).click()
  ok('scans a payment QR from an image into the send form')

  await tab('Agents')
  await popup.getByRole('heading', { name: 'Agents' }).waitFor()
  await tab('Activity')
  await popup.getByRole('heading', { name: 'Activity' }).waitFor()
  await popup.getByRole('radio', { name: 'Received' }).click()

  await tab('Settings')
  await popup.getByText(new URL(DAPP).origin).waitFor()
  await popup.getByRole('radio', { name: '30 min' }).click()
  await popup.getByRole('button', { name: /Show recovery phrase/ }).click()
  await popup.getByLabel('Wallet password').fill('wrong password')
  await popup.getByRole('button', { name: 'Show phrase' }).click()
  await popup.getByText('Wrong password.').waitFor()
  await popup.getByLabel('Wallet password').fill(PASSWORD)
  await popup.getByRole('button', { name: 'Show phrase' }).click()
  await popup.locator('.words span').first().waitFor()
  assert.equal((await popup.locator('.words span').allTextContents()).map((t) => t.replace(/^\d+/, '')).join(' '), MNEMONIC)
  await popup.getByRole('button', { name: 'Done' }).click()
  await popup.getByRole('button', { name: /Export secret key/ }).click()
  await popup.getByLabel('Wallet password').fill(PASSWORD)
  await popup.getByRole('button', { name: 'Show secret key' }).click()
  await popup.getByText('SBGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O34RMTB343OYPXU5DJDVMN').waitFor()
  await popup.getByRole('button', { name: 'Done' }).click()
  assert.equal((await sw.evaluate(() => chrome.storage.local.get('autoLockMin'))).autoLockMin, 30)

  // Reader test with a reader that types decimal: same device hash as the hex UID.
  await popup.getByRole('radio', { name: 'Decimal', exact: true }).click()
  await popup.getByRole('button', { name: /Test the reader/ }).click()
  await popup.getByLabel('Card UID').pressSequentially(String(0x04a2b3c4d5e680n), { delay: 4 })
  await popup.keyboard.press('Enter')
  await popup.getByRole('heading', { name: 'Card read' }).waitFor()
  await popup.getByText('04A2B3C4D5E680').waitFor()
  await popup.getByText(createHash('sha256').update('04A2B3C4D5E680').digest('hex')).waitFor()
  await shot(popup, '09-reader-test')
  await popup.getByRole('button', { name: 'Done' }).click()
  await popup.getByRole('radio', { name: 'Hex' }).click()
  ok('reader test turns a decimal reader’s output into the UID and device hash')
  await shot(popup, '06-settings')
  await tab('Wallet')
  ok('cards, agents, activity and settings screens work; phrase and secret need the password')

  // Locked wallet: the approval window asks for the password first.
  await popup.reload()
  await popup.getByRole('button', { name: 'Lock' }).click()
  const opened = ctx.waitForEvent('page')
  const lockedSign = dapp.evaluate(() => window.noir.stellar.signMessage('after lock'))
  const win = await opened
  await win.waitForLoadState()
  await win.locator('input[type=password]').fill(PASSWORD)
  await win.getByRole('button', { name: 'Approve' }).click()
  assert.equal(typeof (await lockedSign).signedMessage, 'string')
  ok('unlocks from the approval window, then signs')

  console.log('\nAll e2e checks passed.')
} finally {
  await ctx.close()
  server.close()
  await rm(profile, { recursive: true, force: true })
}
