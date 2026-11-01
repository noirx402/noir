import { Networks } from '@stellar/stellar-sdk'

export interface NoirContracts {
  deviceRegistry: string
  agentRegistry: string
  paymentEscrow: string
}

export interface NoirNetworkConfig {
  rpcUrl: string
  networkPassphrase: string
  contracts: NoirContracts
}

/**
 * Noir's public Testnet deployment. Each redeploy mints new IDs; keep these in
 * step with deploy-evidence/ and frontend/.env (see Noir/_Redeploy Contracts.md).
 */
export const TESTNET: NoirNetworkConfig = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  contracts: {
    deviceRegistry: 'CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5',
    agentRegistry: 'CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV',
    paymentEscrow: 'CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS',
  },
}
