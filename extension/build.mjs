// Bundles the extension into dist/ (load it via chrome://extensions → Load unpacked).
import { build, context } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const watch = process.argv.includes('--watch')
const r = (p) => fileURLToPath(new URL(p, import.meta.url))

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: 'chrome111',
  inject: [r('./src/shims/buffer.ts')],
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  alias: {
    // The SDK from this repo, built against this package's single copy of stellar-sdk.
    '@noirx402/agent-sdk': r('../sdk/agent-sdk/src/index.ts'),
    '@stellar/stellar-sdk': r('./node_modules/@stellar/stellar-sdk'),
  },
  logLevel: 'info',
  legalComments: 'none',
}

const entries = [
  { in: 'src/background.ts', out: 'background', format: 'esm' },
  { in: 'src/popup/popup.ts', out: 'popup', format: 'esm' },
  { in: 'src/approve/approve.ts', out: 'approve', format: 'esm' },
  // Content scripts can't be modules.
  { in: 'src/content.ts', out: 'content', format: 'iife', inject: [] },
  { in: 'src/inpage.ts', out: 'inpage', format: 'iife', inject: [] },
]

await rm(r('./dist'), { recursive: true, force: true })
await mkdir(r('./dist'), { recursive: true })
await Promise.all([
  cp(r('./manifest.json'), r('./dist/manifest.json')),
  cp(r('./public'), r('./dist'), { recursive: true }),
  cp(r('./src/popup/popup.html'), r('./dist/popup.html')),
  cp(r('./src/approve/approve.html'), r('./dist/approve.html')),
])

const configs = entries.map((e) => ({
  ...common,
  ...(e.inject ? { inject: e.inject } : {}),
  entryPoints: { [e.out]: r(`./${e.in}`) },
  outdir: r('./dist'),
  format: e.format,
}))

if (watch) {
  for (const c of configs) await (await context(c)).watch()
} else {
  await Promise.all(configs.map((c) => build(c)))
}
