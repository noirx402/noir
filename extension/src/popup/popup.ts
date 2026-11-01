import { activity } from './activity'
import { agents, cards } from './cards'
import { nav, refresh, type Tab } from './kit'
import { onboarding, onEntered, unlockScreen } from './onboarding'
import { pay } from './pay'
import { scanQr, type ScanTarget } from './qrscan'
import { settings } from './settings'
import { home, sendForm } from './wallet'

const TABS: Record<Tab, () => unknown> = { wallet: home, pay: () => pay(), cards, agents, activity, settings }

// Remembered per viewer so the popup reopens where it was left.
const lastTab = (): Tab => {
  try { const t = sessionStorage.getItem('tab') as Tab | null; return t && t in TABS ? t : 'wallet' } catch { return 'wallet' }
}

nav.tab = async (t: Tab) => {
  const s = await refresh()
  if (!s.hasWallet) return onboarding()
  if (!s.unlocked) return unlockScreen()
  try { sessionStorage.setItem('tab', t) } catch { /* storage blocked */ }
  void TABS[t]()
}

// popup.html#scan-send / #scan-pay: the camera scanner, opened in a window
// because a popup can't show Chrome's camera prompt.
const scanTarget = /^#scan-(send|pay)$/.exec(location.hash)?.[1] as ScanTarget | undefined

async function scanEntry() {
  const s = await refresh()
  if (!s.hasWallet) return onboarding()
  if (!s.unlocked) return unlockScreen()
  scanQr(scanTarget!, (r) => {
    if (scanTarget === 'send') sendForm(r)
    else void pay('pay', { merchant: r.destination, amount: r.amount })
  }, () => window.close())
}

onEntered(() => (scanTarget ? scanEntry() : nav.tab('wallet')))

if (location.hash === '#onboarding' || scanTarget) document.body.classList.add('window')
void (scanTarget ? scanEntry() : nav.tab(lastTab()))
