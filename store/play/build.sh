#!/usr/bin/env bash
# Regenerates the Google Play listing graphics from the app's own assets.
# Needs ImageMagick 7 (`magick`) and the extension's Playwright install
# (`cd extension && npm ci && npx playwright install chromium`).
# Run from anywhere: store/play/build.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SHOTS="$ROOT/frontend/assets/screenshots"
BG='#0A0A0A'

# App icon: 512x512 PNG.
magick "$ROOT/frontend/assets/icon.png" -resize 512x512 "$HERE/icon-512.png"

# Phone screenshots: 1080x1920 (9:16). The raw captures are taller than
# Play's 2:1 limit, so each is scaled to full height and centred on the
# app background.
mkdir -p "$HERE/screenshots"
rm -f "$HERE/screenshots/"*.png
n=1
for s in 01-wallet 05-tap-to-pay 02-link-card 03-agents 04-card-detail 07-send-review 06-receive-nfc 08-activity; do
  magick "$SHOTS/$s.png" -resize x1920 -background "$BG" -gravity center -extent 1080x1920 \
    "$HERE/screenshots/$(printf '%02d' "$n")-${s#*-}.png"
  n=$((n + 1))
done

# Feature graphic: 1024x500, rendered at 2x from HTML then downsampled.
NODE_PATH="$ROOT/extension/node_modules" node -e '
  const { chromium } = require("playwright")
  ;(async () => {
    const b = await chromium.launch()
    const p = await b.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 2 })
    await p.goto("file://" + process.argv[1])
    await p.evaluate(() => document.fonts.ready)
    await p.screenshot({ path: process.argv[2] })
    await b.close()
  })()
' "$HERE/src/feature-graphic.html" "$HERE/.feature@2x.png"
magick "$HERE/.feature@2x.png" -resize 1024x500! -strip "$HERE/feature-graphic-1024x500.png"
rm "$HERE/.feature@2x.png"

magick identify -format '%f %wx%h\n' "$HERE/icon-512.png" "$HERE/feature-graphic-1024x500.png" "$HERE/screenshots/"*.png
