import { readFileSync, existsSync } from 'node:fs'
import type { NoirAgentClientOptions } from '@noirx402/agent-sdk'
import type { ApiKeyRecord } from './keys.js'

export interface ServerConfig {
  port: number
  keys: ApiKeyRecord[]
  defaultRateLimit: number
  corsOrigins: string[]
  webhooksFile?: string
  allowInsecureWebhooks: boolean
  client: NoirAgentClientOptions
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const keysFile = env.NOIR_API_KEYS_FILE ?? './keys.json'
  const keys: ApiKeyRecord[] = env.NOIR_API_KEYS
    ? JSON.parse(env.NOIR_API_KEYS)
    : existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, 'utf8')) : []

  const contracts = [env.NOIR_DEVICE_REGISTRY, env.NOIR_AGENT_REGISTRY, env.NOIR_PAYMENT_ESCROW]
  const custom = contracts.some(Boolean)
  if (custom && !(contracts.every(Boolean) && env.NOIR_RPC_URL && env.NOIR_NETWORK_PASSPHRASE)) {
    throw new Error('Set NOIR_RPC_URL, NOIR_NETWORK_PASSPHRASE and all three NOIR_* contract IDs, or none of them')
  }

  return {
    port: Number(env.PORT ?? 8787),
    keys,
    defaultRateLimit: Number(env.NOIR_API_RATE_LIMIT ?? 120),
    corsOrigins: (env.NOIR_API_CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    webhooksFile: env.NOIR_API_WEBHOOKS_FILE ?? './webhooks.json',
    allowInsecureWebhooks: env.NOIR_API_ALLOW_INSECURE_WEBHOOKS === 'true',
    client: custom
      ? {
          network: {
            rpcUrl: env.NOIR_RPC_URL!,
            networkPassphrase: env.NOIR_NETWORK_PASSPHRASE!,
            contracts: { deviceRegistry: contracts[0]!, agentRegistry: contracts[1]!, paymentEscrow: contracts[2]! },
          },
        }
      : { rpcUrl: env.NOIR_RPC_URL },
  }
}
