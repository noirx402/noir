/** One place for every URL, ID and fact the site repeats. */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://noirx402.github.io/noir').replace(/\/$/, '')
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
/** Prefix for files in /public (next/link handles basePath itself; plain src/href don't). */
export const asset = (path: string) => `${BASE_PATH}${path}`

export const SITE_NAME = 'Noir'
/** Share card, 1200×630 (public/og.png). */
export const OG_IMAGE = { url: `${SITE_URL}/og.png`, width: 1200, height: 630, alt: 'Noir — Tap. Pay. Done. NFC tap-to-pay on Stellar' }
export const TAGLINE = 'Tap. Pay. Done.'
export const DESCRIPTION =
  'Noir is an open-source Stellar wallet you pay with by tapping an NFC card. Each card is bound to a constrained agent on Soroban — per-payment cap, one asset, an expiry — so a tap pays without unlocking your phone.'

export const REPO = 'https://github.com/noirx402/noir'
export const REPO_TREE = `${REPO}/tree/main`
export const REPO_BLOB = `${REPO}/blob/main`
/** Latest GitHub release ("Beta Testing"). On a new release, update the tag, asset name and label together. */
export const RELEASE_TAG = 'Beta-Testing'
export const RELEASE_LABEL = 'Beta 1.0.0'
export const RELEASE_URL = `${REPO}/releases/tag/${RELEASE_TAG}`
export const APK_URL = `${REPO}/releases/download/${RELEASE_TAG}/app-release.apk`
/** Noir browser extension (GitHub release until the Chrome Web Store listing is live). */
export const EXTENSION_TAG = 'extension-v0.1.0'
export const EXTENSION_ZIP = `${REPO}/releases/download/${EXTENSION_TAG}/noir-wallet-extension-0.1.0.zip`
export const EXTENSION_RELEASE = `${REPO}/releases/tag/${EXTENSION_TAG}`
export const DEMO_ON_X = 'https://x.com/Noirx402/status/2109282993588334632'
/** Google Play closed-beta sign-up (Google Form) and its announcement post. */
export const BETA_FORM_URL = 'https://forms.gle/8tA3qwUVwnKEKikY6'
export const BETA_POST_ON_X = 'https://x.com/Noirx402/status/2109813001289380199'

/** Live Stellar Testnet deployment (see deploy-evidence/ in the repo). */
export const CONTRACTS = [
  {
    name: 'device_registry',
    id: 'CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5',
    role: 'Binds the SHA-256 hash of an NFC tag to the wallet that owns it.',
  },
  {
    name: 'agent_registry',
    id: 'CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV',
    role: 'Stores each device’s agent policy: which key may spend, which asset, how much per payment, until when.',
  },
  {
    name: 'payment_escrow',
    id: 'CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS',
    role: 'Holds each device’s pre-funded balance; authorizes taps within policy and lets merchants claim in batch.',
  },
] as const

export const explorer = (contractId: string) => `https://stellar.expert/explorer/testnet/contract/${contractId}`

export const KEYWORDS = [
  'Noir', 'Noir wallet', 'Stellar wallet', 'NFC payments', 'tap to pay crypto', 'Soroban smart contracts',
  'x402', 'agent payments', 'delegated payment authorization', 'Stellar SDK', 'NTAG213', 'Stellar Community Fund',
]
