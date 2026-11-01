import { colorWithOpacity } from '@/constants/designTokens'
import { useState, useCallback } from 'react'
import { View, Text, StyleSheet, ScrollView, Share, Platform } from 'react-native'
import { PressableScale } from '@/components/brand/PressableScale'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import QRCode from 'react-native-qrcode-svg'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { sha256 } from '@noble/hashes/sha2.js'
import { Buffer } from 'buffer'
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Fonts, Gradient } from '@/constants/theme'
import { Toast } from '@/components/Toast'
import { useAppStore } from '@/store/useAppStore'
import { nfcService } from '@/services/nfc'
import { x402 } from '@/domain/x402'
import { stellarService } from '@/services/stellar-service'
import { AppConfig } from '@/constants/config'
import { logger } from '@/lib/logger'
import { humanizeStellarError } from '@/lib/stellarErrors'
import { AmountEntry } from '@/components/flow/AmountEntry'
import { ProcessingOverlay } from '@/components/flow/ProcessingOverlay'
import { keypadValueToNumber } from '@/lib/keypadInput'
import { openReceipt } from '@/lib/receipt'
import { startLocalTx, settleLocalTx } from '@/lib/localTx'
import { formatAmount } from '@/lib/txFormat'
import { ScreenHeader } from '@/components/ScreenHeader'
import { TextAction } from '@/components/ui/List'
import { Button } from '@/components/Button'
import { Segmented } from '@/components/ui/Segmented'
import { PaymentRequestQr } from '@/components/flow/PaymentRequestQr'

type ReceiveMode = 'address' | 'nfc' | 'qr'

export function ReceiveScreen() {
  const router = useRouter()
  const { user, balance, devices, setBalance } = useAppStore()
  const [mode, setMode] = useState<ReceiveMode>('address')
  const [showQr, setShowQr] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<'XLM'>('XLM')
  const [amount, setAmount] = useState('')
  const [nfcState, setNfcState] = useState<'idle' | 'scanning' | 'processing'>('idle')
  const [nfcError, setNfcError] = useState('')
  const [notLinked, setNotLinked] = useState(false)
  // Set when the tap failed because the card is short — offers "Top up".
  const [fundCardId, setFundCardId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ visible: boolean; type: 'success' | 'info'; title: string; message?: string }>({
    visible: false,
    type: 'success',
    title: '',
  })

  const address = user?.stellarPublicKey || 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
  const balanceAmount = balance.xlm

  const amountUnits = keypadValueToNumber(amount)

  const copyAddress = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await Clipboard.setStringAsync(address)
    setToast({ visible: true, type: 'success', title: 'Address Copied', message: 'Stellar address copied to clipboard' })
  }

  const shareAddress = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    await Share.share({ message: `Send ${selectedAsset} to me on Noir: ${address}` })
  }

  const handleNfcReceive = useCallback(async () => {
    if (amountUnits <= 0) return
    const fail = (msg: string, linkHint = false, fundCardId: string | null = null) => {
      setNfcState('idle')
      setNfcError(msg)
      setNotLinked(linkHint)
      setFundCardId(fundCardId)
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    }

    setNfcState('scanning')
    setNfcError('')
    setNotLinked(false)
    setFundCardId(null)
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

    let localId: string | null = null
    try {
      const tag = await nfcService.readTag(10000)

      if (!tag?.uid) {
        fail('No card detected — hold the card flat against the back of the phone and try again.')
        return
      }

      if (__DEV__) logger.debug('[Receive NFC] tag detected:', tag.uid)
      setNfcState('processing')

      const hashBytes = sha256(new TextEncoder().encode(tag.uid))
      const scannedHash = Buffer.from(hashBytes).toString('hex')

      // Look up the card, then its agent key on this phone. Never fall back to
      // agent 1: on a phone with several cards that paid from the wrong (often
      // empty) agent wallet and failed.
      const linkedDevice = devices.find((d) => d.deviceUidHash === scannedHash)
      if (!linkedDevice?.agentPublicKey) {
        fail('This card isn’t linked to an agent on this phone yet.', true)
        return
      }
      const agentIndex = await x402.resolveAgentIndex(scannedHash, linkedDevice.agentPublicKey)
      if (agentIndex == null) {
        fail(`${linkedDevice.label}’s agent key isn’t on this phone, so it can’t pay from here.`)
        return
      }

      // Pay directly from the agent wallet to your address
      const merchantAddr = user?.stellarPublicKey
      if (!merchantAddr) throw new Error('No wallet configured')

      const amountXLM = amountUnits.toFixed(7)
      if (__DEV__) logger.debug('[Receive NFC] paying', amountXLM, 'XLM from agent to', merchantAddr.slice(0, 8))
      // Pending in Activity (wallet and the card) while the agent pays.
      localId = startLocalTx({
        merchantName: `Tap · ${linkedDevice.label}`,
        merchantId: linkedDevice.agentPublicKey,
        amountCents: Math.round(amountUnits * 100),
        direction: 'in',
        deviceId: scannedHash,
      })
      const payResult = await x402.payWithAgent({
        agentIndex,
        destination: merchantAddr,
        amount: amountXLM,
      })
      if ('error' in payResult) {
        settleLocalTx(localId, { status: 'failed', errorMessage: humanizeStellarError(payResult.error) })
        const short = /balance|not enough|underfunded|budget/i.test(payResult.error)
        fail(humanizeStellarError(payResult.error), false, short ? linkedDevice.id : null)
        return
      }
      const txHash = payResult.hash

      if (__DEV__) logger.debug('[Receive NFC] queued:', txHash)

      // Hash attached; txMonitor flips it to confirmed when the ledger closes.
      settleLocalTx(localId, { stellarTxHash: txHash })
      useAppStore.getState().addPendingTxHash(txHash)

      // Refresh the wallet balance in the background — the receipt shouldn't wait on it.
      if (user?.stellarPublicKey) {
        const pub = user.stellarPublicKey
        stellarService.invalidateBalance(pub)
        stellarService.getBalance(pub)
          .then((onChain) => setBalance({ xlm: onChain.xlm, subentryCount: onChain.subentryCount }))
          .catch(() => { /* non-critical */ })
      }

      setNfcState('idle')
      setAmount('')
      openReceipt(router, {
        title: 'NFC payment received',
        amountCents: Math.round(amountUnits * 100),
        assetCode: 'XLM',
        direction: 'in',
        // Submitted, not yet final — the receipt says so honestly.
        status: 'pending',
        createdAt: new Date().toISOString(),
        counterpartyLabel: 'From',
        counterparty: linkedDevice.agentPublicKey,
        hash: txHash,
        note: `Paid by ${linkedDevice.label}`,
      }, 'push')
    } catch (e: any) {
      logger.error('[Receive NFC] error:', e?.message)
      if (localId) settleLocalTx(localId, { status: 'failed', errorMessage: humanizeStellarError(e) })
      fail(humanizeStellarError(e) || 'NFC receive failed')
    }
  }, [amountUnits, devices, user, router])

  const resetNfc = () => {
    setNfcState('idle')
    setNfcError('')
    setNotLinked(false)
    setFundCardId(null)
  }

  const network = useAppStore.getState().network
  const name = user?.displayName?.trim() || 'My wallet'

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title="Receive" onBackPress={() => router.back()} />
      <Segmented
        value={mode}
        onChange={(m) => { resetNfc(); setShowQr(false); setMode(m) }}
        options={[{ value: 'address', label: 'Address' }, { value: 'nfc', label: 'NFC tap' }, { value: 'qr', label: 'QR' }]}
        style={styles.segment}
      />

      {mode === 'address' && (
        <>
          <ScrollView contentContainerStyle={styles.addressArea} showsVerticalScrollIndicator={false}>
            <Text style={styles.walletName}>{name}</Text>
            <View style={styles.qrCard}>
              <QRCode value={address} size={196} backgroundColor={Colors.white} color={Colors.black} />
            </View>
            <Text style={styles.fullAddress} selectable>{address}</Text>
            <View style={styles.netNote}>
              <Ionicons name="information-circle-outline" size={16} color={network === 'mainnet' ? Colors.mainnet : Colors.testnet} />
              <Text style={styles.netNoteText}>Only send Stellar assets on {network === 'mainnet' ? 'Mainnet' : 'Testnet'}</Text>
            </View>
            <Text style={styles.balanceLine}>Balance {balanceAmount.toLocaleString()} XLM</Text>
          </ScrollView>
          <View style={styles.footerRow}>
            <View style={styles.flex1}><Button label="Copy" icon="copy-outline" onPress={copyAddress} fullWidth /></View>
            <View style={styles.flex1}><Button label="Share" icon="share-outline" variant="secondary" onPress={shareAddress} fullWidth /></View>
          </View>
        </>
      )}

      {mode === 'qr' && (
        showQr ? (
          <ScrollView contentContainerStyle={styles.addressArea}>
            <PaymentRequestQr
              address={address}
              amountXlm={amountUnits}
              onPaid={(p) => {
                if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
                setShowQr(false)
                setAmount('')
                openReceipt(router, {
                  title: 'QR payment received',
                  amountCents: Math.round(p.amountXlm * 100),
                  assetCode: 'XLM',
                  direction: 'in',
                  status: 'confirmed',
                  createdAt: new Date().toISOString(),
                  counterpartyLabel: 'From',
                  counterparty: p.from,
                  hash: p.hash,
                  note: 'Paid by QR',
                }, 'push')
              }}
            />
            <TextAction label="Change amount" icon="create-outline" onPress={() => setShowQr(false)} />
          </ScrollView>
        ) : (
          <>
            <Text style={styles.nfcPrompt}>Enter the amount, then show the QR. The payer scans it with Noir or any Stellar wallet.</Text>
            <AmountEntry
              value={amount}
              onChangeValue={setAmount}
              caption="Request a set amount"
              quickAmounts={[5, 10, 25, 50]}
              ctaLabel="Show QR"
              onSubmit={() => setShowQr(true)}
              ctaDisabled={amountUnits <= 0}
            />
          </>
        )
      )}

      {mode === 'nfc' && (
        <>
          <Text style={styles.nfcPrompt}>Enter the amount, then have the payer tap their card on your phone.</Text>
          <AmountEntry
            value={amount}
            onChangeValue={(v) => { setNfcError(''); setNotLinked(false); setFundCardId(null); setAmount(v) }}
            caption="Paid from the card’s balance"
            error={nfcError || null}
            quickAmounts={[5, 10, 25, 50]}
            ctaLabel="Tap card to receive"
            onSubmit={handleNfcReceive}
            ctaDisabled={amountUnits <= 0 || nfcState !== 'idle'}
          />
          {notLinked && (
            <TextAction label="Link this card" icon="link-outline" onPress={() => router.push('/link-device')} />
          )}
          {fundCardId && (
            <TextAction label="Top up this card" icon="add" onPress={() => router.push({ pathname: '/agent-fund/[id]', params: { id: fundCardId } })} />
          )}
        </>
      )}

      <ProcessingOverlay
        visible={nfcState !== 'idle'}
        variant={nfcState === 'scanning' ? 'nfc' : 'verify'}
        title={nfcState === 'scanning' ? 'Hold the card to your phone' : 'Authorizing payment'}
        subtitle={`Receiving ${formatAmount(Math.round(amountUnits * 100))} XLM`}
        steps={[
          { label: nfcState === 'scanning' ? 'Waiting for card' : 'Card detected', state: nfcState === 'scanning' ? 'active' : 'done' },
          { label: 'Agent signs the payment', state: nfcState === 'processing' ? 'active' : 'pending' },
          { label: 'Submitted to Stellar', state: 'pending' },
        ]}
      />

      <Toast
        visible={toast.visible}
        type={toast.type}
        title={toast.title}
        message={toast.message}
        onDismiss={() => setToast((prev) => ({ ...prev, visible: false }))}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surfaceBg },
  flex1: { flex: 1 },
  segment: { marginHorizontal: 20 },
  addressArea: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 20, paddingVertical: Spacing.lg },
  walletName: { fontFamily: Fonts.display, fontSize: FontSize.md + 1, color: Colors.cream },
  qrCard: { padding: Spacing.md, backgroundColor: Colors.white, borderRadius: 20 },
  fullAddress: { fontFamily: Fonts.mono, fontSize: FontSize.sm - 1, lineHeight: 20, color: Colors.silver, textAlign: 'center', maxWidth: 280 },
  netNote: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.midGrey },
  netNoteText: { fontSize: FontSize.sm - 1, color: Colors.silver },
  balanceLine: { fontSize: FontSize.xs, color: Colors.mutedWhite },
  footerRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: Spacing.sm, paddingBottom: Spacing.lg },
  nfcPrompt: { fontSize: FontSize.sm, color: Colors.mutedWhite, textAlign: 'center', lineHeight: 20, paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
})
