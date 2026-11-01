// Runs the house server and the Vite dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process'

const procs = [
  spawn('npx', ['tsx', 'server/main.ts'], { stdio: 'inherit' }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
]
const stop = () => { for (const p of procs) p.kill('SIGTERM') }
for (const p of procs) p.on('exit', (code) => { stop(); process.exitCode = code ?? 0 })
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
