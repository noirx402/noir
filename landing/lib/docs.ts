import type { Metadata } from 'next'
import { OG_IMAGE, SITE_URL } from './site'

export const DOCS = [
  { slug: '', title: 'Overview', description: 'How Noir works for developers: devices, agent policies, escrow, and the ways to integrate.' },
  { slug: 'quickstart', title: 'Quickstart', description: 'Read a Noir card policy and check a payment in five minutes, with the SDK or the REST API.' },
  { slug: 'sdk', title: 'TypeScript SDK', description: 'Reference for @noirx402/agent-sdk: reads, payment checks, tap-to-pay, owner operations, events and signers.' },
  { slug: 'api', title: 'REST API & API keys', description: 'Self-host the Noir API gateway: API keys, scopes, rate limits, endpoints, non-custodial transactions and errors.' },
  { slug: 'extension', title: 'Browser extension', description: 'Noir for Chrome: the window.noir.stellar SEP-43 provider, Stellar Wallets Kit support, and how dApps connect and request signatures.' },
  { slug: 'webhooks', title: 'Webhooks & events', description: 'Every Noir on-chain event, signed webhook delivery, and how to verify the X-Noir-Signature header.' },
  { slug: 'contracts', title: 'Smart contracts', description: 'The three Noir Soroban contracts on Stellar Testnet: IDs, functions, error codes and call order.' },
] as const

export type DocSlug = (typeof DOCS)[number]['slug']

export const docPath = (slug: string) => (slug ? `/docs/${slug}/` : '/docs/')

export function docMetadata(slug: DocSlug): Metadata {
  const d = DOCS.find((x) => x.slug === slug)!
  const title = slug ? `${d.title} — Docs` : 'Developer documentation'
  const url = `${SITE_URL}${docPath(slug)}`
  return {
    title,
    description: d.description,
    alternates: { canonical: url },
    openGraph: { type: 'article', siteName: 'Noir', title: `${title} · Noir`, description: d.description, url, images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title: `${title} · Noir`, description: d.description, images: [OG_IMAGE.url] },
  }
}
