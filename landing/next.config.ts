import type { NextConfig } from 'next'

// GitHub Pages serves this repo's site under /noir; the Pages workflow
// passes that in. Locally and on a custom domain it is empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

const config: NextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
}

export default config
