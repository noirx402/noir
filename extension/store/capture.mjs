// Captures real extension screens (2x) for the Chrome Web Store listing.
// Run: npm run build && node store/capture.mjs <outdir>
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Account, Address, Asset, hash, Keypair, Networks, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk'

const OUT = process.argv[2]
const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const MNEMONIC = 'illness spike retreat truth genius clock brain pass fit cave bargain toe'
const ADDRESS = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6'

const server = createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end('<!doctype html><title>Stellar dApp</title>') })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const profile = await mkdtemp(join(tmpdir(), 'noir-cap-'))
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, deviceScaleFactor: 2, viewport: { width: 360, height: 600 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
})
try {
  let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent('serviceworker')
  const id = new URL(sw.url()).host
  const p = await ctx.newPage()
  await p.goto(`chrome-extension://${id}/popup.html`)
  await p.screenshot({ path: join(OUT, 'welcome.png') })
  await p.getByRole('button', { name: 'I already have a recovery phrase' }).click()
  await p.locator('textarea').fill(MNEMONIC)
  await p.getByRole('button', { name: 'Continue' }).click()
  await p.locator('input[type=password]').nth(0).fill('correct horse battery')
  await p.locator('input[type=password]').nth(1).fill('correct horse battery')
  await p.getByRole('button', { name: 'Create wallet' }).click()
  await p.getByText('Connected sites').waitFor()

  const dapp = await ctx.newPage()
  await dapp.goto(`http://localhost:${server.address().port}/`)
  const approve = async (fn, arg, name, button) => {
    const opened = ctx.waitForEvent('page')
    const result = dapp.evaluate(fn, arg)
    const w = await opened
    await w.setViewportSize({ width: 380, height: 640 })
    await w.getByRole('button', { name: button }).waitFor()
    await w.screenshot({ path: join(OUT, `${name}.png`) })
    await w.getByRole('button', { name: button }).click()
    return result
  }
  await approve(() => window.noir.stellar.requestAccess(), null, 'connect', 'Connect')
  const tx = new TransactionBuilder(new Account(ADDRESS, '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey(), asset: Asset.native(), amount: '12.5' }))
    .setTimeout(300).build()
  await approve(([x, n]) => window.noir.stellar.signTransaction(x, { networkPassphrase: n }), [tx.toXDR(), Networks.TESTNET], 'sign-tx', 'Approve')
  const pre = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(new xdr.HashIdPreimageSorobanAuthorization({
    networkId: hash(Buffer.from(Networks.TESTNET)), nonce: xdr.Int64.fromString('1'), signatureExpirationLedger: 812345,
    invocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
        contractAddress: new Address('CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS').toScAddress(),
        functionName: 'claim', args: [new Address('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC').toScVal(), new Address(ADDRESS).toScVal()],
      })), subInvocations: [],
    }),
  })).toXDR('base64')
  await approve((e) => window.noir.stellar.signAuthEntry(e), pre, 'sign-auth', 'Approve')
  await p.reload(); await p.getByText('Connected sites').waitFor(); await p.waitForTimeout(3000)
  await p.screenshot({ path: join(OUT, 'home.png') })
} finally { await ctx.close(); server.close() }
