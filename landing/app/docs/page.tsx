import Link from 'next/link'
import { DocPage } from '@/components/DocPage'
import { docMetadata } from '@/lib/docs'
import { REPO } from '@/lib/site'

export const metadata = docMetadata('')

export default function DocsHome() {
  return (
    <DocPage slug="">
      <p>
        Noir turns an NFC card into a payment method on Stellar. Everything that makes that work lives in three
        open Soroban contracts, so any application can read a card’s rules, accept its payments and react to
        what happens on-chain — without asking Noir for permission.
      </p>

      <h2 id="model">The model in one minute</h2>
      <ul className="doc-list">
        <li><b>Device.</b> A card is identified by the 64-hex SHA-256 of its UID (the <em>device hash</em>). <code>device_registry</code> maps it to its owner’s wallet.</li>
        <li><b>Agent policy.</b> The owner authorizes one <em>agent</em> key per device in <code>agent_registry</code>: which asset, a per-payment cap (<code>maxAmount</code>, <code>0</code> = no cap) and an optional expiry.</li>
        <li><b>Escrow.</b> The owner pre-funds the device in <code>payment_escrow</code>. Taps can only spend that balance.</li>
        <li><b>Tap.</b> The agent calls <code>authorize</code>; the contract enforces the policy and credits the merchant, who later calls <code>claim</code>.</li>
        <li><b>Revoke.</b> Revoking the agent stops spending; the owner withdraws or sweeps the remaining escrow.</li>
      </ul>

      <h2 id="choose">Choose how to integrate</h2>
      <div className="doc-cards">
        <Link href="/docs/sdk/" className="doc-card"><b>TypeScript SDK</b><span>Node 22.23.4+, browsers, React Native. Talks to Soroban RPC directly — no server, no key.</span></Link>
        <Link href="/docs/api/" className="doc-card"><b>REST API</b><span>Any language. Self-hosted gateway with API keys, scopes, rate limits and webhooks.</span></Link>
        <Link href="/docs/contracts/" className="doc-card"><b>Contracts directly</b><span>Call the Soroban contracts with any Stellar SDK or the Stellar CLI.</span></Link>
      </div>

      <h2 id="units">Conventions</h2>
      <ul className="doc-list">
        <li>Amounts are integers in the asset’s smallest unit. For XLM, 1 XLM = <code>10000000</code> stroops. The SDK uses <code>bigint</code>; the API uses decimal strings.</li>
        <li>Addresses are Stellar strkeys: <code>G…</code> for accounts, <code>C…</code> for contracts (including token contracts such as native XLM’s SAC).</li>
        <li>Noir currently runs on <b>Stellar Testnet</b>. Fund test accounts with Friendbot.</li>
      </ul>

      <p className="doc-callout">
        Everything here is MIT-licensed. Source: <a href={`${REPO}/tree/main/sdk`} target="_blank" rel="noopener">sdk/</a> and{' '}
        <a href={`${REPO}/tree/main/backend/contracts`} target="_blank" rel="noopener">backend/contracts/</a>.
      </p>
    </DocPage>
  )
}
