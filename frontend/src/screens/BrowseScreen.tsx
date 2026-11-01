import { ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TextInput, Share, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView as RNWebView, WebViewNavigation } from 'react-native-webview'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { PressableScale } from '@/components/brand/PressableScale'
import { NetworkPicker } from '@/components/NetworkPicker'
import { PageTitle, SectionLabel, ListRow } from '@/components/ui/List'
import { useAppStore } from '@/store/useAppStore'
import { getItem, setItem } from '@/services/storage'
import { Colors, Spacing, FontSize, Gradient } from '@/constants/theme'
import { toBrowserUrl } from '@/lib/browserUrl'
import { POPULAR_APPS, SCF_APPS, SCF_DIRECTORY_URL, recommendMessage, type StellarApp } from '@/constants/stellarApps'
import * as Crypto from 'expo-crypto'
import { Sheet, PopupDetails, popup } from '@/components/popup/Popup'
import { Button } from '@/components/Button'
import {
  buildProviderScript, buildResponseScript, parseBridgeMessage, httpsOrigin, networkDetails,
  summarizeTransaction, dappError, DappError, type DappRequest, type TxSummary,
} from '@/lib/dappBridge'
import { dappConnections } from '@/services/dappConnections'
import { signForDapp } from '@/services/dappSigner'
import { authenticateWithDevice } from '@/services/biometrics'
import { logger } from '@/lib/logger'
import { ErrorState } from '@/components/ui/ErrorState'
import { VerifyingPulse } from '@/components/brand/VerifyingPulse'

// react-native-webview 14 intersects its iOS/Android/Windows prop types, which
// collapse to `never` under our TS config. The component is fine at runtime;
// type only the props we use.
interface BrowserWebViewProps {
  source: { uri: string }
  style?: object
  onNavigationStateChange?: (e: WebViewNavigation) => void
  onLoadProgress?: (e: { nativeEvent: { progress: number } }) => void
  onMessage?: (e: { nativeEvent: { data: string; url: string } }) => void
  onLoadStart?: () => void
  onLoadEnd?: () => void
  onError?: (e: { nativeEvent: { description?: string; code?: number } }) => void
  domStorageEnabled?: boolean
  javaScriptEnabled?: boolean
  thirdPartyCookiesEnabled?: boolean
  mediaPlaybackRequiresUserAction?: boolean
  injectedJavaScriptBeforeContentLoaded?: string
  injectedJavaScriptBeforeContentLoadedForMainFrameOnly?: boolean
  setSupportMultipleWindows?: boolean
  allowsBackForwardNavigationGestures?: boolean
  originWhitelist?: string[]
  ref?: React.Ref<WebViewHandle>
}
interface WebViewHandle { goBack(): void; goForward(): void; reload(): void; stopLoading(): void; injectJavaScript(js: string): void }
const WebView = RNWebView as unknown as ComponentType<BrowserWebViewProps>

const RECENT_KEY = 'browser_recent'
const MAX_RECENT = 8

type IoniconName = keyof typeof Ionicons.glyphMap
const SCF_PREVIEW = 5

interface Recent { url: string; title: string }


function host(url: string): string {
  try { return new URL(url).host.replace(/^www\./, '') } catch { return url }
}

/**
 * Browse tab: Stellar apps opened in an in-app browser. Browsing only — the
 * page never gets a bridge to the wallet, so websites can't see or use keys.
 */
export function BrowseScreen() {
  const network = useAppStore((s) => s.network)
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [recent, setRecent] = useState<Recent[]>([])
  const address = useAppStore((s) => s.user?.stellarPublicKey)
  const [connected, setConnected] = useState<string[]>([])
  const [showAllScf, setShowAllScf] = useState(false)

  useEffect(() => {
    getItem<Recent[]>(RECENT_KEY).then((r) => setRecent(Array.isArray(r) ? r : [])).catch(() => {})
  }, [])

  // Re-read after closing the browser: a site may have been connected there.
  useEffect(() => {
    if (url || !address) return
    dappConnections.list(address).then(setConnected).catch(() => {})
  }, [url, address])

  const disconnect = async (origin: string) => {
    if (!address) return
    const ok = await popup.confirm({
      title: `Disconnect ${host(origin)}?`,
      message: 'The site will no longer see your address or be able to ask for signatures.',
      icon: 'unlink-outline',
      confirmLabel: 'Disconnect',
    })
    if (!ok) return
    await dappConnections.remove(address, origin)
    setConnected((c) => c.filter((o) => o !== origin))
  }

  const remember = useCallback((entry: Recent) => {
    setRecent((prev) => {
      const next = [entry, ...prev.filter((r) => r.url !== entry.url)].slice(0, MAX_RECENT)
      setItem(RECENT_KEY, next).catch(() => {})
      return next
    })
  }, [])

  const open = (target: string | null) => {
    if (!target) return
    setQuery('')
    setUrl(target)
  }

  const appUrl = (a: StellarApp) => (network !== 'mainnet' && a.testnetUrl ? a.testnetUrl : a.url)
  const recommend = (a: StellarApp) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Share.share({ message: recommendMessage(a) }).catch(() => {})
  }
  const scfShown = showAllScf ? SCF_APPS : SCF_APPS.slice(0, SCF_PREVIEW)

  if (url) return <BrowserView url={url} onClose={() => setUrl(null)} onVisited={remember} testnet={network !== 'mainnet'} />

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageTitle title="Browse" right={<NetworkPicker align="right" />} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={Colors.mutedWhite} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search or enter address"
            placeholderTextColor={Colors.mutedWhite}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => open(toBrowserUrl(query))}
            accessibilityLabel="Search or enter address"
          />
        </View>

        <SectionLabel title="Stellar apps" />
        {POPULAR_APPS.map((a, i) => (
          <ListRow
            key={a.name}
            icon={a.icon}
            iconColor={Colors.gold}
            title={a.name}
            subtitle={a.scf ? `${a.desc} · SCF funded` : a.desc}
            chevron
            last={i === POPULAR_APPS.length - 1}
            onPress={() => open(appUrl(a))}
            onLongPress={() => recommend(a)}
          />
        ))}

        <SectionLabel
          title="Funded by the Stellar Community Fund"
          right={
            <PressableScale onPress={() => open(SCF_DIRECTORY_URL)} accessibilityRole="link" accessibilityLabel="See all SCF funded projects">
              <Text style={styles.sectionLink}>See all</Text>
            </PressableScale>
          }
        />
        <Text style={styles.sectionNote}>
          {network !== 'mainnet'
            ? 'Projects backed by Stellar’s grant program. Most run on Mainnet only, so your Testnet balance won’t show there.'
            : 'Projects backed by Stellar’s grant program. Tap the share icon to recommend one.'}
        </Text>
        {scfShown.map((a, i) => (
          <ListRow
            key={a.name}
            icon={a.icon}
            iconColor={Colors.gold}
            title={a.name}
            subtitle={a.desc}
            last={i === scfShown.length - 1 && showAllScf}
            onPress={() => open(appUrl(a))}
            onLongPress={() => recommend(a)}
            right={
              <PressableScale onPress={() => recommend(a)} style={styles.shareBtn} accessibilityRole="button" accessibilityLabel={`Recommend ${a.name}`}>
                <Ionicons name="share-social-outline" size={20} color={Colors.mutedWhite} />
              </PressableScale>
            }
          />
        ))}
        {!showAllScf && SCF_APPS.length > SCF_PREVIEW && (
          <ListRow
            icon="chevron-down"
            iconColor={Colors.mutedWhite}
            title={`Show ${SCF_APPS.length - SCF_PREVIEW} more`}
            titleColor={Colors.gold}
            last
            onPress={() => setShowAllScf(true)}
          />
        )}

        {connected.length > 0 && (
          <>
            <SectionLabel title="Connected sites" />
            {connected.map((o, i) => (
              <ListRow key={o} icon="link-outline" iconColor={Colors.success} title={host(o)} subtitle="Tap to disconnect" last={i === connected.length - 1} onPress={() => disconnect(o)} />
            ))}
          </>
        )}

        {recent.length > 0 && (
          <>
            <SectionLabel title="Recent" />
            {recent.map((r, i) => (
              <ListRow key={r.url} icon="time-outline" iconColor={Colors.mutedWhite} title={r.title || host(r.url)} subtitle={host(r.url)} chevron last={i === recent.length - 1} onPress={() => open(r.url)} />
            ))}
          </>
        )}

        <Text style={styles.note}>Sites you connect can see your address and ask you to sign. Your keys never leave this phone, and nothing is signed without your approval.</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

function BrowserView({ url, onClose, onVisited, testnet }: { url: string; onClose: () => void; onVisited: (r: Recent) => void; testnet: boolean }) {
  const web = useRef<WebViewHandle>(null)
  const [nav, setNav] = useState<{ url: string; title: string; back: boolean; fwd: boolean }>({ url, title: '', back: false, fwd: false })
  const [progress, setProgress] = useState(0)
  // What the WebView loads. Changes when the user submits the address bar.
  const [src, setSrc] = useState(url)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const go = () => {
    const next = toBrowserUrl(draft)
    setEditing(false)
    if (!next) return
    setLoadError(null)
    if (next === src) web.current?.reload()
    else setSrc(next)
  }

  const retry = () => { setLoadError(null); web.current?.reload() }

  // ── dApp bridge (window.noir) ──
  const address = useAppStore((s) => s.user?.stellarPublicKey ?? null)
  const network = useAppStore((s) => s.network)
  const nonce = useMemo(() => Crypto.randomUUID(), [])
  const providerJs = useMemo(() => buildProviderScript(nonce), [nonce])
  const [pending, setPending] = useState<PendingRequest | null>(null)
  const pendingRef = useRef<PendingRequest | null>(null)
  const [signing, setSigning] = useState(false)
  const [siteConnected, setSiteConnected] = useState(false)
  const currentOrigin = httpsOrigin(nav.url)

  useEffect(() => {
    if (!address || !currentOrigin) { setSiteConnected(false); return }
    dappConnections.isConnected(address, currentOrigin).then(setSiteConnected).catch(() => setSiteConnected(false))
  }, [address, currentOrigin])

  const respond = (id: string, result: unknown) => web.current?.injectJavaScript(buildResponseScript(id, result))

  const show = (p: PendingRequest | null) => { pendingRef.current = p; setPending(p) }

  const decline = () => {
    const p = pendingRef.current
    if (!p || signing) return
    respond(p.req.id, dappError(DappError.userDeclined, 'The user declined the request'))
    show(null)
  }

  const onMessage = async (e: { nativeEvent: { data: string; url: string } }) => {
    const req = parseBridgeMessage(e.nativeEvent.data, nonce)
    if (!req) return
    // The origin comes from the WebView, never from the message.
    const origin = httpsOrigin(e.nativeEvent.url)
    if (!origin) return respond(req.id, dappError(DappError.invalidRequest, 'Noir only connects to https sites'))
    if (!address) return respond(req.id, dappError(DappError.internal, 'No wallet is set up in Noir'))
    const net = networkDetails(network)
    try {
      if (req.method === 'getNetwork' || req.method === 'getNetworkDetails') return respond(req.id, net)
      const isConnected = await dappConnections.isConnected(address, origin)
      if (req.method === 'isAllowed') return respond(req.id, { isAllowed: isConnected })
      if (req.method === 'getAddress') {
        return respond(req.id, isConnected ? { address } : dappError(DappError.notConnected, 'Call requestAccess first'))
      }
      if (req.method === 'requestAccess' && isConnected) return respond(req.id, { address })
      if (pendingRef.current) return respond(req.id, dappError(DappError.invalidRequest, 'Another request is already waiting for approval'))
      if (req.method === 'requestAccess') return show({ kind: 'connect', req, origin })

      // signTransaction
      if (!isConnected) return respond(req.id, dappError(DappError.notConnected, 'Call requestAccess first'))
      if (!req.params.xdr) return respond(req.id, dappError(DappError.invalidRequest, 'Missing transaction XDR'))
      if (req.params.networkPassphrase && req.params.networkPassphrase !== net.networkPassphrase) {
        return respond(req.id, dappError(DappError.invalidRequest, `Noir is on ${network === 'mainnet' ? 'Mainnet' : 'Testnet'}. Switch networks in Noir and try again.`))
      }
      if (req.params.address && req.params.address !== address) {
        return respond(req.id, dappError(DappError.invalidRequest, 'That account is not the active Noir account'))
      }
      let summary: TxSummary
      try {
        summary = summarizeTransaction(req.params.xdr, net.networkPassphrase, address)
      } catch {
        return respond(req.id, dappError(DappError.invalidRequest, 'Not a valid transaction for this network'))
      }
      show({ kind: 'sign', req, origin, summary, networkPassphrase: net.networkPassphrase })
    } catch (err: any) {
      logger.warn('browser: dapp request failed', err?.message)
      respond(req.id, dappError(DappError.internal, 'Noir could not handle the request'))
    }
  }

  const approveConnect = async () => {
    const p = pendingRef.current
    if (!p || p.kind !== 'connect' || !address) return
    await dappConnections.add(address, p.origin)
    setSiteConnected(true)
    respond(p.req.id, { address })
    show(null)
  }

  const approveSign = async () => {
    const p = pendingRef.current
    if (!p || p.kind !== 'sign' || !address || signing) return
    setSigning(true)
    try {
      const auth = await authenticateWithDevice(`Sign for ${host(p.origin)}`)
      // No screen lock on the phone: the app is already unlocked and the user
      // just approved this exact transaction, same as an in-app send.
      if (!auth.ok && auth.reason !== 'no-device-lock') return
      if (pendingRef.current !== p) return
      const signedTxXdr = await signForDapp(p.req.params.xdr!, p.networkPassphrase, address)
      respond(p.req.id, { signedTxXdr, signerAddress: address })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      show(null)
    } catch (err: any) {
      logger.warn('browser: dapp signing failed', err?.message)
      respond(p.req.id, dappError(DappError.internal, err?.message ?? 'Signing failed'))
      show(null)
      popup.notice({ title: 'Couldn’t sign', message: err?.message ?? 'Signing failed', tone: 'danger' })
    } finally {
      setSigning(false)
    }
  }

  const onNav = (e: WebViewNavigation) => {
    setNav({ url: e.url, title: e.title, back: e.canGoBack, fwd: e.canGoForward })
    if (!e.loading && e.url.startsWith('https://')) onVisited({ url: e.url, title: e.title })
    // A request belongs to the page that made it; leaving that site cancels it.
    const p = pendingRef.current
    if (p && httpsOrigin(e.url) !== p.origin && !signing) show(null)
  }

  return (
    // Top only: the tab bar below already pads for the bottom inset.
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.bar}>
        <PressableScale style={styles.tool} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close browser">
          <Ionicons name="close" size={24} color={Colors.white} />
        </PressableScale>
        <View style={[styles.urlPill, editing && styles.urlPillEditing]}>
          {!editing && siteConnected && <View style={styles.connectedDot} />}
          {!editing && (loading
            ? <VerifyingPulse size={14} />
            : <Ionicons name={nav.url.startsWith('https://') ? 'lock-closed' : 'warning-outline'} size={12} color={nav.url.startsWith('https://') ? Colors.mutedWhite : Colors.warning} />)}
          <TextInput
            style={[styles.urlText, styles.urlInput, editing && styles.urlInputEditing]}
            value={editing ? draft : host(nav.url)}
            onChangeText={setDraft}
            onFocus={() => { setDraft(nav.url); setEditing(true) }}
            onBlur={() => setEditing(false)}
            onSubmitEditing={go}
            selectTextOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            placeholder="Search or enter address"
            placeholderTextColor={Colors.mutedWhite}
            numberOfLines={1}
            accessibilityLabel={`Address ${nav.url}${siteConnected ? ', connected to your wallet' : ''}. Edit to go somewhere else`}
          />
        </View>
        <PressableScale style={styles.tool} onPress={() => Linking.openURL(nav.url)} accessibilityRole="button" accessibilityLabel="Open in your browser">
          <Ionicons name="open-outline" size={20} color={Colors.white} />
        </PressableScale>
      </View>
      <View style={styles.progressTrack}>{loading && <View style={[styles.progressFill, { width: `${Math.max(8, progress * 100)}%` }]} />}</View>
      {testnet && (
        <View style={styles.netStrip}>
          <View style={styles.netDot} />
          <Text style={styles.netText}>You’re on Testnet · sites can’t move your funds</Text>
        </View>
      )}

      <View style={styles.web}>
      <WebView
        ref={web}
        source={{ uri: src }}
        style={styles.web}
        onNavigationStateChange={onNav}
        onLoadStart={() => { setLoading(true); setProgress(0) }}
        onLoadEnd={() => setLoading(false)}
        onError={(e) => { setLoading(false); setLoadError(e.nativeEvent.description ?? 'The page didn’t respond') }}
        onLoadProgress={(e: { nativeEvent: { progress: number } }) => setProgress(e.nativeEvent.progress)}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        mediaPlaybackRequiresUserAction
        onMessage={onMessage}
        injectedJavaScriptBeforeContentLoaded={providerJs}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        originWhitelist={['https://*']}
      />
      {/* First paint: the page is still blank, so show the loader over it. */}
      {loading && progress < 0.3 && !loadError && (
        <View style={styles.loadingCover} pointerEvents="none">
          <VerifyingPulse size={96} />
          <Text style={styles.loadingText}>Loading {host(src)}…</Text>
        </View>
      )}
      {loadError && (
        <View style={styles.errorCover}>
          <ErrorState
            icon="cloud-offline-outline"
            tone="neutral"
            title="Couldn’t open this page"
            message="Check your connection or the address, then try again."
            details={loadError}
            primary={{ label: 'Try again', icon: 'refresh', onPress: retry }}
          />
        </View>
      )}
      </View>

      <View style={styles.toolbar}>
        <Tool icon="chevron-back" label="Back" disabled={!nav.back} onPress={() => web.current?.goBack()} />
        <Tool icon="chevron-forward" label="Forward" disabled={!nav.fwd} onPress={() => web.current?.goForward()} />
        {loading
          ? <Tool icon="close" label="Stop loading" onPress={() => { web.current?.stopLoading(); setLoading(false) }} />
          : <Tool icon="refresh" label="Reload" onPress={retry} />}
        <Tool icon="share-outline" label="Share" onPress={() => Share.share({ message: nav.url }).catch(() => {})} />
      </View>

      <Sheet
        visible={pending?.kind === 'connect'}
        onClose={decline}
        icon="link-outline"
        title={pending ? `Connect to ${host(pending.origin)}?` : ''}
        subtitle="The site will see your wallet address and can ask you to sign transactions. Nothing is signed without your approval."
        footer={<Button label="Connect" onPress={approveConnect} fullWidth />}
      >
        {address && (
          <PopupDetails rows={[
            { label: 'Wallet', value: address, mono: true },
            { label: 'Network', value: network === 'mainnet' ? 'Mainnet' : 'Testnet' },
          ]} />
        )}
      </Sheet>

      <Sheet
        visible={pending?.kind === 'sign'}
        onClose={decline}
        dismissible={!signing}
        icon="create-outline"
        tone={pending?.kind === 'sign' && pending.summary.operations.some((o) => o.risky) ? 'danger' : 'brand'}
        title="Sign transaction"
        subtitle={pending ? `Requested by ${host(pending.origin)}` : undefined}
        footer={
          <Button
            label="Sign"
            icon="finger-print-outline"
            variant={pending?.kind === 'sign' && pending.summary.operations.some((o) => o.risky) ? 'danger' : 'primary'}
            onPress={approveSign}
            loading={signing}
            fullWidth
          />
        }
      >
        {pending?.kind === 'sign' && <SignSummary summary={pending.summary} network={network} />}
      </Sheet>
    </SafeAreaView>
  )
}

type PendingRequest =
  | { kind: 'connect'; req: DappRequest; origin: string }
  | { kind: 'sign'; req: DappRequest; origin: string; summary: TxSummary; networkPassphrase: string }

function SignSummary({ summary, network }: { summary: TxSummary; network: string }) {
  const risky = summary.operations.some((o) => o.risky)
  const foreign = summary.foreignSource || summary.operations.some((o) => o.foreignSource)
  return (
    <View style={styles.signBody}>
      <View style={styles.ops}>
        {summary.operations.map((o, i) => (
          <View key={i} style={[styles.op, i > 0 && styles.opDivider]}>
            <Text style={[styles.opLabel, o.risky && { color: Colors.danger }]}>{o.label}</Text>
            {!!o.detail && <Text style={styles.opDetail}>{o.detail}</Text>}
          </View>
        ))}
      </View>
      <PopupDetails rows={[
        { label: 'Network', value: network === 'mainnet' ? 'Mainnet' : 'Testnet' },
        { label: 'Max fee', value: `${summary.feeXlm} XLM` },
        ...(summary.memo ? [{ label: 'Memo', value: summary.memo }] : []),
        ...(summary.feeBump ? [{ label: 'Type', value: 'Fee bump' }] : []),
      ]} />
      {risky && <Text style={styles.warn}>This can give away control of your account or empty it. Only sign if you fully trust this site.</Text>}
      {foreign && <Text style={styles.caution}>Part of this transaction uses an account that isn’t your active wallet.</Text>}
    </View>
  )
}

function Tool({ icon, label, onPress, disabled }: { icon: IoniconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <PressableScale style={[styles.tool, disabled && styles.dim]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={Colors.white} />
    </PressableScale>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surfaceBg },
  content: { paddingHorizontal: 20, paddingBottom: Spacing.xxl },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, paddingHorizontal: 14, borderRadius: 14, backgroundColor: Colors.midGrey, marginTop: Spacing.sm },
  searchInput: { flex: 1, color: Colors.white, fontSize: FontSize.md - 1, paddingVertical: 0 },
  sectionLink: { fontSize: FontSize.sm, color: Colors.gold, fontWeight: '600', paddingVertical: Spacing.xs },
  sectionNote: { fontSize: FontSize.xs, color: Colors.mutedWhite, lineHeight: 18, marginTop: -Spacing.xs, marginBottom: Spacing.xs },
  shareBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -Spacing.sm },
  note: { fontSize: FontSize.xs, color: Colors.mutedWhite, lineHeight: 18, paddingTop: Spacing.lg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  tool: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.35 },
  urlPill: { flex: 1, height: 38, borderRadius: 12, backgroundColor: Colors.midGrey, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: Spacing.md },
  urlPillEditing: { justifyContent: 'flex-start', borderWidth: 1, borderColor: Colors.gold },
  urlInput: { flexShrink: 1, paddingVertical: 0, textAlign: 'center', minWidth: 60 },
  urlInputEditing: { flex: 1, textAlign: 'left' },
  loadingCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Colors.surfaceBg, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { color: Colors.mutedWhite, fontSize: FontSize.sm },
  errorCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: Colors.surfaceBg },
  connectedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success },
  signBody: { gap: Spacing.md },
  ops: { borderRadius: 14, backgroundColor: Colors.midGrey, paddingHorizontal: Spacing.md },
  op: { paddingVertical: 10, gap: 2 },
  opDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Gradient.panel },
  opLabel: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '600' },
  opDetail: { color: Colors.mutedWhite, fontSize: FontSize.sm - 1, lineHeight: 18 },
  warn: { color: Colors.danger, fontSize: FontSize.sm - 1, lineHeight: 18, textAlign: 'center' },
  caution: { color: Colors.warning, fontSize: FontSize.sm - 1, lineHeight: 18, textAlign: 'center' },
  urlText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '500', flexShrink: 1 },
  progressTrack: { height: 3, backgroundColor: Gradient.panel },
  progressFill: { height: 3, backgroundColor: Colors.gold },
  netStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 6, backgroundColor: Colors.midGrey },
  netDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.testnet },
  netText: { color: Colors.silver, fontSize: FontSize.xs },
  web: { flex: 1, backgroundColor: Colors.white },
  toolbar: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', height: 56, borderTopWidth: 1, borderTopColor: Gradient.panel },
})
