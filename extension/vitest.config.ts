import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Same aliases as build.mjs: the repo's SDK source on this package's single stellar-sdk.
export default defineConfig({
  resolve: {
    alias: {
      '@noirx402/agent-sdk': r('../sdk/agent-sdk/src/index.ts'),
      '@stellar/stellar-sdk': r('./node_modules/@stellar/stellar-sdk'),
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
})
