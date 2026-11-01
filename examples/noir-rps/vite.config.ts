import { defineConfig } from 'vite'

// The house server (server/main.ts) runs on 8787; the page calls it as /api.
export default defineConfig({
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:8787' } },
  preview: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
})
