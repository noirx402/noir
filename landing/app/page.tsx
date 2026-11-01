import Link from 'next/link'
import type { Metadata } from 'next'
import { Icon } from '@/components/Icons'
import { CodeBlock } from '@/components/CodeBlock'
import { JsonLd } from '@/components/JsonLd'
import {
  APK_URL, BETA_FORM_URL, EXTENSION_STORE_URL, BETA_POST_ON_X, CONTRACTS, DEMO_ON_X, DESCRIPTION, RELEASE_LABEL, RELEASE_URL, REPO, REPO_BLOB, SITE_NAME, SITE_URL, asset,
} from '@/lib/site'

export const metadata: Metadata = { alternates: { canonical: `${SITE_URL}/` } }

const FAQ = [
  {
    q: 'What is Noir?',
    a: 'Noir is an open-source Stellar wallet for Android that lets you pay by tapping an NFC card, sticker or wearable. Each linked card is bound to a payment agent with on-chain limits, so a tap can pay without unlocking your phone.',
  },
  {
    q: 'What happens if I lose a card?',
    a: 'Revoke it from the app. The agent stops being able to spend immediately, and the card’s remaining escrow is returned to your main wallet. A card can never spend more than its per-payment cap, in its one asset, before its expiry.',
  },
  {
    q: 'Can other apps accept Noir payments?',
    a: 'Yes. The TypeScript SDK (@noirx402/agent-sdk) and the self-hostable REST API with API keys let any app read card policies, check a payment, run tap-to-pay, and receive signed webhooks.',
  },
  {
    q: 'Is Noir on mainnet?',
    a: 'Not yet. Noir runs on Stellar Testnet as a reference implementation funded by the Stellar Community Fund. Contracts, app and SDK are MIT-licensed.',
  },
]

const SDK_SNIPPET = `
import { NoirAgentClient } from '@noirx402/agent-sdk'

const noir = new NoirAgentClient() // Stellar Testnet

const check = await noir.checkPayment({ deviceHash, agent, asset, amount: 10_000_000n })
if (check.ok) await noir.authorizePayment({ agent: agentSigner, deviceHash, merchant, asset, amount: 10_000_000n })
`

export default function Home() {
  const app = {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: SITE_NAME,
    description: DESCRIPTION,
    url: SITE_URL,
    operatingSystem: 'Android',
    applicationCategory: 'FinanceApplication',
    downloadUrl: APK_URL,
    softwareVersion: '1.0.0-beta',
    license: `${REPO_BLOB}/LICENSE`,
    image: `${SITE_URL}/og.png`,
    screenshot: `${SITE_URL}/assets/images/tour/04-dashboard.png`,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }

  return (
    <>
      <JsonLd data={app} />
      <JsonLd data={faq} />

      {/* HERO */}
      <section className="hero">
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="kicker">Tap into trust</p>
            <h1>Tap. Pay. Done.</h1>
            <p className="lede">
              A Stellar wallet you pay with by tapping an NFC card. Each card gets its own
              x402 agent that signs the tap&nbsp;— no unlock, no app, no confirmation.
            </p>
            <div className="hero-actions">
              <a className="btn btn-gold" href={APK_URL} download>Download for Android</a>
              <a className="btn btn-ghost" href={EXTENSION_STORE_URL} target="_blank" rel="noopener">Add to Chrome</a>
              <Link className="btn btn-ghost" href="/docs/">Build with Noir</Link>
            </div>
            <p className="dl-note">
              {RELEASE_LABEL} · Stellar Testnet · Android APK · <a href={RELEASE_URL} target="_blank" rel="noopener">Release notes</a> · Google Play coming soon ·{' '}
              <a href={BETA_FORM_URL} target="_blank" rel="noopener">Become a beta tester</a>
            </p>
            <dl className="hero-facts">
              <div><dt>Settlement</dt><dd>~5s ledgers</dd></div>
              <div><dt>Network</dt><dd>Stellar</dd></div>
              <div><dt>Contracts</dt><dd>3 on Soroban</dd></div>
            </dl>
          </div>

          <div className="hero-visual">
            <div className="phone phone-hero" role="img" aria-label="Noir home screen showing a 10,000 XLM balance, send, receive, tap and top-up actions, and assets list">
              <div className="screen" aria-hidden="true">
                <div className="scr-top">
                  <span className="net-pill"><i className="net-dot" />Testnet<Icon name="chev" size="xs" /></span>
                  <span className="acct">
                    <span className="acct-name"><span className="avatar">A</span>Main wallet<Icon name="chev" size="xs" /></span>
                    <span className="mono acct-addr">GBX7…Q4MZ</span>
                  </span>
                  <Icon name="bell" className="scr-bell" />
                </div>
                <div className="scr-balance">
                  <div><span className="bal-num">10,000.00</span><span className="bal-unit">XLM</span></div>
                  <p>Stellar Testnet · updated just now</p>
                </div>
                <div className="scr-actions">
                  <span><i><Icon name="send" /></i>Send</span>
                  <span><i><Icon name="recv" /></i>Receive</span>
                  <span><i className="is-gold"><Icon name="nfc" /></i>Tap</span>
                  <span><i><Icon name="plus" /></i>Top up</span>
                </div>
                <div className="scr-tabs"><span className="is-on">Assets</span><span>Activity</span><span>Cards</span></div>
                <ul className="scr-list">
                  <li><Icon name="star" className="gold" /><div><b>Stellar Lumens</b><small>XLM</small></div><div className="r"><b>10,000.00</b><small>Available 9,998.99</small></div></li>
                  <li><Icon name="nfc" className="gold" /><div><b>On your cards</b><small>2 cards · tap balances</small></div><div className="r"><b>40.00</b><small>XLM</small></div></li>
                </ul>
                <ul className="scr-list scr-list-activity">
                  <li><Icon name="send" /><div><b>Coffee Stand</b><small>Tap · Black card · 09:41</small></div><div className="r"><b>−12.50 XLM</b></div></li>
                  <li><Icon name="recv" /><div><b>Friendbot</b><small>Received · Yesterday</small></div><div className="r"><b className="pos">+10,000 XLM</b></div></li>
                </ul>
                <nav className="scr-nav"><span className="is-on">Wallet</span><span>Agents</span><span>Browse</span><span>Settings</span></nav>
              </div>
            </div>
            <div className="toast" aria-hidden="true">
              <Icon name="nfc" className="gold" />
              <div><b>Paid · Coffee Stand</b><small>12.50 XLM · confirmed on Stellar</small></div>
            </div>
          </div>
        </div>
      </section>

      {/* BETA TESTERS */}
      <section className="beta" id="beta">
        <div className="container">
          <div className="beta-card reveal">
            <div className="beta-copy">
              <p className="kicker">Beta testers wanted</p>
              <h2>Help us launch on Google Play.</h2>
              <p>
                Noir is building a new way to experience blockchain payments through tap-to-pay,
                powered by Stellar and x402. We’re preparing for our Google Play Store launch and
                need Android users willing to test the app, share feedback and help make Noir better.
              </p>
              <p className="beta-sub">Every tester brings us one step closer to launch.</p>
            </div>
            <div className="beta-actions">
              <a className="btn btn-gold" href={BETA_FORM_URL} target="_blank" rel="noopener">
                <Icon name="play" size="xs" />Sign up to test
              </a>
              <a className="text-link" href={BETA_POST_ON_X} target="_blank" rel="noopener">
                Read the announcement on X <Icon name="arrow" size="xs" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* STATEMENT */}
      <section className="statement">
        <div className="container">
          <p className="statement-text reveal">
            Paying should be invisible. Noir debits the moment your tag touches the terminal&nbsp;—{' '}
            <span className="dim">built for transit turnstiles, campus canteens, event gates and retail checkout, where every second in the queue counts.</span>
          </p>
          <ul className="no-list reveal">
            <li><Icon name="close" size="xs" />No app to open</li>
            <li><Icon name="close" size="xs" />No screen to unlock</li>
            <li><Icon name="close" size="xs" />No confirmation to tap</li>
          </ul>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="how" id="how-it-works">
        <div className="container">
          <div className="section-head reveal">
            <p className="kicker">How it works</p>
            <h2>From tap to settlement in three steps.</h2>
          </div>
          <ol className="steps">
            <li className="step reveal">
              <div className="phone phone-sm" role="img" aria-label="Welcome screen: a Stellar wallet you pay with by tapping an NFC card">
                <div className="screen screen-welcome" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset('/assets/images/logo-mark.png')} alt="" className="w-mark" />
                  <div className="w-word">NOIR</div>
                  <div className="w-kick">TAP INTO TRUST</div>
                  <p className="w-lede">A Stellar wallet you pay with by tapping an NFC card.</p>
                  <ul className="w-list">
                    <li><Icon name="nfc" className="gold" /><div><b>Any NFC card or sticker</b><small>Link it once — it becomes your tap-to-pay key.</small></div></li>
                    <li><Icon name="agent" className="gold" /><div><b>Agents pay for you</b><small>Each card has its own agent that signs the tap.</small></div></li>
                    <li><Icon name="lock" className="gold" /><div><b>Your keys stay here</b><small>Kept on this phone, behind your wallet password.</small></div></li>
                  </ul>
                  <div className="w-cta"><span className="pill-btn">Create a wallet</span><span className="text-btn">I already have a wallet</span></div>
                </div>
              </div>
              <div className="step-copy">
                <span className="step-num">01</span>
                <h3>Link a card</h3>
                <p>Hold an NFC card, sticker or wearable to your phone and sign once. Soroban’s <code>device_registry</code> records its hashed ID against your wallet.</p>
              </div>
            </li>

            <li className="step reveal">
              <div className="phone phone-sm" role="img" aria-label="Agents tab listing two cards, each with its own balance and per-tap cap">
                <div className="screen screen-agents" aria-hidden="true">
                  <div className="a-title">Agents</div>
                  <p className="a-sub">Each card pays from its own escrow.</p>
                  <ul className="scr-list">
                    <li><Icon name="nfc" className="gold" /><div><b>Black card</b><small><span className="pos">Active</span> · up to 50 XLM per tap</small></div><div className="r"><b>25.00</b><small>XLM</small></div></li>
                    <li><Icon name="nfc" className="gold" /><div><b>Keychain tag</b><small><span className="warn">Expires in 3 days</span> · 20 XLM cap</small></div><div className="r"><b>15.00</b><small>XLM</small></div></li>
                  </ul>
                  <div className="a-meter"><div className="a-meter-row"><span>Black card · escrow used</span><span>25%</span></div><div className="a-bar"><i style={{ width: '25%' }} /></div></div>
                  <div className="a-cta"><span className="pill-btn"><Icon name="plus" size="xs" />Top up agent</span><span className="text-btn">Link another card</span></div>
                  <nav className="scr-nav"><span>Wallet</span><span className="is-on">Agents</span><span>Browse</span><span>Settings</span></nav>
                </div>
              </div>
              <div className="step-copy">
                <span className="step-num">02</span>
                <h3>Set its agent and fund it</h3>
                <p>Each card gets an agent key with a policy you sign: one asset, a per-payment cap and an optional expiry. Fund its escrow; your main balance stays untouched.</p>
              </div>
            </li>

            <li className="step reveal">
              <div className="phone phone-sm" role="img" aria-label="Tap to pay screen with a 12 XLM amount and a ready to tap button">
                <div className="screen screen-tap" aria-hidden="true">
                  <div className="t-head"><Icon name="close" /><span>Tap to pay</span><i /></div>
                  <div className="t-amount">
                    <div className="tap-rings"><i /><i /><i /><Icon name="nfc" className="gold" /></div>
                    <div><span className="t-num">12</span><span className="t-unit">XLM</span></div>
                    <p>Hold the payer’s card to the back of the phone</p>
                  </div>
                  <div className="t-pad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0'].map((k, i) => <span key={i}>{k}</span>)}<span><Icon name="del" /></span></div>
                  <div className="t-cta"><span className="pill-btn"><Icon name="nfc" size="xs" />Ready to tap</span></div>
                </div>
              </div>
              <div className="step-copy">
                <span className="step-num">03</span>
                <h3>Tap</h3>
                <p><code>payment_escrow.authorize</code> checks the policy on-chain and moves funds to the merchant, who claims in batch. Stellar confirms in seconds.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* FEATURES */}
      <section className="features" id="features">
        <div className="container split">
          <div className="section-head reveal">
            <p className="kicker">Features</p>
            <h2>Built for zero-friction commerce.</h2>
            <p className="section-lede">Open contracts, self-custody and sub-cent fees — without asking anyone to change how they pay.</p>
          </div>
          <ul className="rows reveal">
            <li><Icon name="nfc" className="gold" /><div><h3>Zero-interaction payments</h3><p>Tap an NFC card, sticker or wearable (NTAG213) to pay. No unlock required.</p></div></li>
            <li><Icon name="bolt" className="gold" /><div><h3>x402 tap-to-pay</h3><p>The tap carries an x402 payment request; the card’s agent signs it and the escrow contract settles it.</p></div></li>
            <li><Icon name="agent" className="gold" /><div><h3>Constrained agents</h3><p>One agent per card, limited on-chain to one asset, a per-payment cap and an optional expiry.</p></div></li>
            <li><Icon name="blocks" className="gold" /><div><h3>Three Soroban contracts</h3><p><code>device_registry</code>, <code>agent_registry</code> and <code>payment_escrow</code> — open, MIT-licensed, on Testnet.</p></div></li>
            <li><Icon name="shield" className="gold" /><div><h3>Self-custody</h3><p>Owners sign their own registrations and policies via <code>require_auth</code>. Keys never leave the phone.</p></div></li>
            <li><Icon name="code" className="gold" /><div><h3>Built to integrate</h3><p>TypeScript SDK, REST API with API keys, and signed webhooks for every on-chain event.</p></div></li>
          </ul>
        </div>
      </section>

      {/* SECURITY */}
      <section className="security" id="security">
        <div className="container split">
          <div className="section-head reveal">
            <p className="kicker">Security</p>
            <h2>Simple to use. Robust by design.</h2>
            <p className="section-lede">Lose a tag and unlink it — the agent loses its authority and the card’s escrow returns to your wallet.</p>
          </div>
          <ul className="rows reveal">
            <li><Icon name="hash" className="gold" /><div><h3>Hashed device identity</h3><p>Tag UIDs are SHA-256 hashed on the phone. Only the hash is ever written on-chain.</p></div></li>
            <li><Icon name="target" className="gold" /><div><h3>Blast-radius limits</h3><p>A card can only spend its own escrow, within its cap, asset and expiry — never your main funds.</p></div></li>
            <li><Icon name="clock" className="gold" /><div><h3>Replay protection</h3><p>Every authorization carries a strictly increasing nonce; the contract rejects duplicates.</p></div></li>
            <li><Icon name="lock" className="gold" /><div><h3>Encrypted on the phone</h3><p>Wallet keys are sealed behind your wallet password; phone unlock is opt-in. Backups are disabled.</p></div></li>
            <li><Icon name="key" className="gold" /><div><h3>Scoped API keys</h3><p>The Noir API stores only key hashes, scopes each key, rate-limits it, and never holds signing keys.</p></div></li>
          </ul>
        </div>
      </section>

      {/* ARCHITECTURE */}
      <section className="architecture" id="architecture">
        <div className="container">
          <div className="section-head reveal">
            <p className="kicker">Architecture</p>
            <h2>Hardware tap to on-chain settlement.</h2>
          </div>
          <ol className="flow reveal">
            <li><span className="flow-n">01</span><div><h3>Tag</h3><p>NTAG213 card, sticker or wearable</p></div></li>
            <li><span className="flow-n">02</span><div><h3>Phone</h3><p>Reads the tag and SHA-256 hashes its UID</p></div></li>
            <li className="flow-wide">
              <span className="flow-n">03</span>
              <div>
                <h3>Soroban contracts</h3>
                <dl className="contracts">
                  {CONTRACTS.map((c) => (
                    <div key={c.name}><dt><code>{c.name}</code></dt><dd>{c.role}</dd></div>
                  ))}
                </dl>
              </div>
            </li>
            <li><span className="flow-n">04</span><div><h3>Stellar</h3><p>Consensus and settlement in seconds</p></div></li>
            <li><span className="flow-n">05</span><div><h3>Merchant</h3><p>Batch <code>claim</code> of everything pending</p></div></li>
          </ol>
          <p className="note reveal">
            Function-level reference and live Testnet IDs: <Link href="/docs/contracts/">Contracts documentation</Link>.
          </p>
        </div>
      </section>

      {/* DEVELOPERS */}
      <section className="developers" id="developers">
        <div className="container">
          <div className="section-head section-head-row reveal">
            <div>
              <p className="kicker">Developers</p>
              <h2>Accept Noir taps in your app.</h2>
            </div>
            <p className="section-lede">Everything the wallet does is open on-chain. Use the SDK from JavaScript, or call the REST API from any language with an API key.</p>
          </div>

          <div className="dev-grid reveal">
            <Link className="dev-card" href="/docs/sdk/">
              <Icon name="code" className="gold" />
              <h3>TypeScript SDK</h3>
              <p>Read policies, check and authorize payments, claim, and watch events. Node, browser and React Native.</p>
              <span className="text-link">SDK reference <Icon name="arrow" size="xs" /></span>
            </Link>
            <Link className="dev-card" href="/docs/api/">
              <Icon name="key" className="gold" />
              <h3>REST API + API keys</h3>
              <p>Self-host the gateway: hashed keys, scopes, rate limits, and non-custodial prepare → sign → submit.</p>
              <span className="text-link">API reference <Icon name="arrow" size="xs" /></span>
            </Link>
            <Link className="dev-card" href="/docs/webhooks/">
              <Icon name="hook" className="gold" />
              <h3>Signed webhooks</h3>
              <p>Get <code>payment.authorized</code>, <code>escrow.funded</code> and more, HMAC-signed with replay protection.</p>
              <span className="text-link">Webhooks guide <Icon name="arrow" size="xs" /></span>
            </Link>
          </div>

          <div className="dev-code reveal">
            <CodeBlock title="checkout.ts" lang="ts" code={SDK_SNIPPET} />
            <p className="note"><Link href="/docs/quickstart/">Five-minute quickstart</Link> · <a href={`${REPO}/tree/main/sdk`} target="_blank" rel="noopener">Source on GitHub</a></p>
          </div>
        </div>
      </section>

      {/* COMPARE */}
      <section className="compare" id="compare">
        <div className="container split">
          <div className="section-head reveal">
            <p className="kicker">Compared</p>
            <h2>What a card tap can’t do.</h2>
            <p className="section-lede">Every venue that hates checkout queues — transit, canteens, event gates, retail — is a Noir venue.</p>
          </div>
          <div className="table-wrap reveal">
            <table className="compare-table">
              <thead>
                <tr><th scope="col"><span className="sr-only">Feature</span></th><th scope="col">EMV tap</th><th scope="col">Phone wallet</th><th scope="col" className="is-noir">Noir</th></tr>
              </thead>
              <tbody>
                {[
                  ['No phone unlock needed', true, false],
                  ['Self-custody of funds', false, false],
                  ['Sub-cent transaction fees', false, false],
                  ['Stickers and wearables', false, false],
                  ['Per-device on-chain limits', false, false],
                  ['Open smart contracts + API', false, false],
                ].map(([label, emv, phone]) => (
                  <tr key={String(label)}>
                    <th scope="row">{label}</th>
                    <td className={emv ? 'yes' : undefined}>{emv ? 'Yes' : '—'}</td>
                    <td className={phone ? 'yes' : undefined}>{phone ? 'Yes' : '—'}</td>
                    <td className="yes is-noir">Yes</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* DEMO */}
      <section className="demo" id="demo">
        <div className="container">
          <div className="section-head section-head-row reveal">
            <div><p className="kicker">Demo</p><h2>Watch it tap and go.</h2></div>
            <p className="section-lede">One minute with Noir: link a card, give it an agent, and tap to pay on Stellar.</p>
          </div>
          <div className="video reveal">
            <video controls preload="none" playsInline poster={asset('/assets/media/noir-promo-poster.jpg')}>
              <source src={asset('/assets/media/noir-promo.mp4')} type="video/mp4" />
              Your browser doesn’t support embedded video.
            </video>
          </div>
          <p className="note reveal"><a href={DEMO_ON_X} target="_blank" rel="noopener">Watch it on X</a></p>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq" id="faq">
        <div className="container split">
          <div className="section-head reveal">
            <p className="kicker">FAQ</p>
            <h2>Questions, answered.</h2>
          </div>
          <div className="faq-list reveal">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}<Icon name="chev" size="xs" /></summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* STACK */}
      <section className="about">
        <div className="container">
          <div className="reveal">
            <p className="kicker">Stack</p>
            <ul className="stack">
              {['Stellar', 'Soroban · Rust', 'React Native', 'Expo', 'TypeScript', 'NativeWind', 'Zustand', '@stellar/stellar-sdk', 'react-native-nfc-manager', 'Vitest', 'Next.js'].map((s) => <li key={s}>{s}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="final">
        <div className="container final-inner reveal">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset('/assets/images/logo-mark.png')} alt="" className="final-mark" width={72} height={75} />
          <h2>A world where paying is invisible.</h2>
          <p>Your wallet is your identity. Payments happen without friction. Settlement is instant.</p>
          <div className="hero-actions">
            <a className="btn btn-gold" href={APK_URL} download>Download for Android</a>
            <a className="btn btn-ghost" href={BETA_FORM_URL} target="_blank" rel="noopener"><Icon name="play" size="xs" />Join the Google Play beta</a>
            <a className="btn btn-ghost" href={EXTENSION_STORE_URL} target="_blank" rel="noopener">Add Noir to Chrome</a>
            <a className="btn btn-ghost" href={REPO} target="_blank" rel="noopener">Explore the repo</a>
          </div>
          <p className="dl-note">{RELEASE_LABEL} · Stellar Testnet · Android APK · <a href={RELEASE_URL} target="_blank" rel="noopener">Release notes</a></p>
          <a className="text-link" href={`${REPO}/raw/main/ppt/Noir-Wallet-Pitch.pptx`} target="_blank" rel="noopener">View the pitch deck <Icon name="arrow" size="xs" /></a>
        </div>
      </section>
    </>
  )
}
