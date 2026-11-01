/**
 * QR scanning for payment links and addresses, the app's scan-qr screen.
 * Three sources: the camera (in a Noir window, since a popup can't show
 * Chrome's camera prompt), the QR showing on the current tab, or an image.
 * BarcodeDetector where Chrome has it (macOS, ChromeOS, Android), jsQR
 * everywhere else.
 */
import jsQR from 'jsqr'
import { parsePaymentRequest, type PaymentRequest } from '../shared/noir'
import { busy, h } from '../shared/ui'
import { back, btn, onLeave, page } from './kit'

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
const BarcodeDetectorCtor = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
let detector: Detector | null | undefined

async function decodeCanvas(c: HTMLCanvasElement): Promise<string | null> {
  if (detector === undefined) {
    try { detector = BarcodeDetectorCtor ? new BarcodeDetectorCtor({ formats: ['qr_code'] }) : null } catch { detector = null }
  }
  if (detector) {
    try { const [hit] = await detector.detect(c); if (hit) return hit.rawValue } catch { detector = null }
  }
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  const img = ctx.getImageData(0, 0, c.width, c.height)
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

async function decodeImage(src: string | Blob): Promise<string | null> {
  const bmp = await createImageBitmap(typeof src === 'string' ? await (await fetch(src)).blob() : src)
  const c = document.createElement('canvas')
  // Big screenshots decode faster (and as well) scaled down.
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return decodeCanvas(c)
}

export type ScanTarget = 'send' | 'pay'

/** A QR's text as a payment; throws a sentence when it isn't one. */
export function asPayment(text: string): PaymentRequest {
  const req = parsePaymentRequest(text)
  if (!req) throw new Error('That QR isn’t a Stellar address or an XLM payment link.')
  return req
}

const inWindow = () => document.body.classList.contains('window')

/**
 * The scan step. `onResult` gets the payment the QR asks for.
 * In the popup the camera opens in a Noir window, which carries on there.
 */
export function scanQr(target: ScanTarget, onResult: (r: PaymentRequest) => void, onBack: () => void) {
  const err = h('p', { class: 'err', role: 'alert' })
  const video = h('video', { class: 'video', muted: true, playsinline: true, 'aria-label': 'Camera preview' }) as HTMLVideoElement
  const camBox = h('div', { hidden: true }, video, h('p', { class: 'small muted center' }, 'Point the camera at the QR code.'))
  const done = (text: string | null) => {
    if (!text) throw new Error('No QR code found.')
    onResult(asPayment(text))
  }

  const camera = btn('Use the camera', 'gold block', () => busy(camera, err, async () => {
    if (!inWindow()) {
      await chrome.windows.create({ url: chrome.runtime.getURL(`popup.html#scan-${target}`), type: 'popup', width: 400, height: 680, focused: true })
      window.close()
      return
    }
    await startCamera(video, camBox, (t) => { try { done(t) } catch (e) { err.textContent = (e as Error).message } }, err)
  }))

  const tab = btn('Scan the QR on this tab', 'block', () => busy(tab, err, async () => {
    // activeTab: Chrome lets the popup capture the tab it was opened on.
    const shot = await chrome.tabs.captureVisibleTab({ format: 'png' }).catch(() => { throw new Error('Chrome didn’t allow a capture of this tab. Open Noir from the toolbar on the page with the QR.') })
    done(await decodeImage(shot))
  }))

  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': 'QR image' }) as HTMLInputElement
  file.addEventListener('change', () => busy(fromFile, err, async () => {
    const f = file.files?.[0]
    if (f) done(await decodeImage(f))
  }))
  const fromFile = btn('Choose an image', 'block', () => file.click())

  page({
    left: back(onBack),
    body: [
      h('h1', {}, 'Scan a QR code'),
      h('p', { class: 'muted' }, 'A Stellar address or payment link from Noir or any Stellar wallet.'),
      camBox, camera, inWindow() ? null : tab, fromFile, file, err,
    ],
  })
  // Opened for the camera: go straight to it.
  if (inWindow() && location.hash.startsWith('#scan-')) camera.click()
}

async function startCamera(video: HTMLVideoElement, box: HTMLElement, onText: (t: string) => void, err: HTMLElement) {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
  } catch (e) {
    throw new Error((e as Error)?.name === 'NotAllowedError' ? 'Camera access was refused. Allow it for Noir, or choose an image.' : 'No camera is available. Choose an image instead.')
  }
  let stopped = false
  const stop = () => { stopped = true; stream.getTracks().forEach((t) => t.stop()) }
  onLeave(stop)
  video.srcObject = stream
  box.hidden = false
  await video.play()
  const c = document.createElement('canvas')
  const tick = async () => {
    if (stopped) return
    if (video.videoWidth) {
      c.width = video.videoWidth; c.height = video.videoHeight
      c.getContext('2d', { willReadFrequently: true })!.drawImage(video, 0, 0)
      try {
        const text = await decodeCanvas(c)
        if (text) { err.textContent = ''; stop(); onText(text); return }
      } catch { /* next frame */ }
    }
    setTimeout(tick, 200)
  }
  void tick()
}
