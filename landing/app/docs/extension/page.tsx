import Link from 'next/link'
import { DocPage } from '@/components/DocPage'
import { CodeBlock } from '@/components/CodeBlock'
import { docMetadata } from '@/lib/docs'
import { EXTENSION_STORE_URL, REPO } from '@/lib/site'

export const metadata = docMetadata('extension')

const METHODS = [
  ['requestAccess()', '{ address }', 'Asks the user to connect this site (once)'],
  ['getAddress()', '{ address }', 'No prompt once the site is connected'],
  ['getNetwork()', '{ network, networkPassphrase }', 'TESTNET or PUBLIC'],
  ['signTransaction(xdr, opts?)', '{ signedTxXdr, signerAddress }', 'Refuses another network without prompting'],
  ['signAuthEntry(preimageXdr, opts?)', '{ signedAuthEntry, signerAddress }', 'Signature over sha256(HashIdPreimage)'],
  ['signMessage(message, opts?)', '{ signedMessage, signerAddress }', 'SEP-53'],
  ['isConnected() · isAllowed()', '{ isConnected } · { isAllowed }', ''],
]

const ERRORS = [
  ['-1', 'Internal, wallet locked, or site not connected'],
  ['-2', 'Invalid input, or an address the wallet doesn’t hold'],
  ['-3', 'Wrong network or unsupported'],
  ['-4', 'The user rejected the request'],
]

export default function Extension() {
  return (
    <DocPage slug="extension">
      <p>
        Noir for Chrome is a Stellar wallet that any dApp can connect to. Users can import the same recovery
        phrase as the Noir app (SEP-5), and every connection and signature is approved in a Noir window that shows
        exactly what is being signed.
      </p>

      <h2 id="install">Install</h2>
      <p>
        <a className="btn btn-gold" href={EXTENSION_STORE_URL} target="_blank" rel="noopener">Add Noir to Chrome</a>
      </p>
      <p>Install it from the <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener">Chrome Web Store</a>, then pin Noir from the puzzle-piece menu. Or build it from source and load it unpacked:</p>
      <CodeBlock lang="bash" code={`
cd extension
npm ci && npm run build
# chrome://extensions → Developer mode → Load unpacked → extension/dist
`} />

      <h2 id="kit">With the Stellar Wallets Kit</h2>
      <p>Noir ships a kit module, so it appears next to Varial, xBull and the rest:</p>
      <CodeBlock lang="ts" code={`
import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit'
import { defaultModules } from '@creit-tech/stellar-wallets-kit/modules/utils'
import { NoirModule } from '@creit-tech/stellar-wallets-kit/modules/noir'

StellarWalletsKit.init({ modules: [...defaultModules(), new NoirModule()] })
`} />
      <p className="doc-callout">
        The module is being proposed to the kit; until it is published there, copy{' '}
        <a href={`${REPO}/tree/main/extension/kit-module`} target="_blank" rel="noopener">extension/kit-module/noir.module.ts</a>{' '}
        into your app.
      </p>

      <h2 id="provider">Direct provider: window.noir.stellar</h2>
      <p>A <a href="https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md" target="_blank" rel="noopener">SEP-43</a> provider, injected before your page’s scripts run. Methods never reject; they resolve with the result or <code>{'{ error: { code, message } }'}</code>.</p>
      <CodeBlock lang="ts" code={`
const noir = window.noir?.stellar
if (!noir) return showInstallNoir()

const { address, error } = await noir.requestAccess()
if (error) return console.warn(error.code, error.message)

const { signedTxXdr } = await noir.signTransaction(tx.toXDR(), { networkPassphrase: Networks.TESTNET })
`} />
      <div className="table-wrap"><table className="doc-table">
        <thead><tr><th>Method</th><th>Resolves with</th><th>Notes</th></tr></thead>
        <tbody>{METHODS.map(([m, r, n]) => <tr key={m}><td><code>{m}</code></td><td><code>{r}</code></td><td>{n}</td></tr>)}</tbody>
      </table></div>
      <div className="table-wrap"><table className="doc-table">
        <thead><tr><th>error.code</th><th>Meaning</th></tr></thead>
        <tbody>{ERRORS.map(([c, m]) => <tr key={c}><td><code>{c}</code></td><td>{m}</td></tr>)}</tbody>
      </table></div>

      <h2 id="with-sdk">With the Noir SDK</h2>
      <CodeBlock lang="ts" code={`
import { NoirAgentClient, noirExtensionSigner } from '@noirx402/agent-sdk'

const merchant = await noirExtensionSigner()
await new NoirAgentClient().claim({ merchant, token: asset })
`} />
      <p>See the <Link href="/docs/sdk/#wallet-signers">SDK reference</Link> for every operation.</p>

      <h2 id="security">Security model</h2>
      <ul className="doc-list">
        <li>The recovery phrase is encrypted with AES-256-GCM under a PBKDF2-SHA256 (600k) key from the user’s password.</li>
        <li>The unlocked key lives only in session memory and auto-locks after 15 minutes.</li>
        <li>Sites get the address only after the user connects them; the origin comes from the browser, not the page.</li>
        <li>Auth entries are checked against the wallet’s network before signing.</li>
      </ul>
    </DocPage>
  )
}
