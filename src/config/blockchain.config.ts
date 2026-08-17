import { registerAs } from '@nestjs/config';

export interface IBlockchainConfig {
  enabled: boolean;
  pollIntervalMs: number;
  leaseDurationMs: number;
  retryBaseDelayMs: number;
  channelName: string;
  chaincodeName: string;
  mspId: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsRootCertPath?: string;
  identityCertPath?: string;
  identityKeyPath?: string;
}

export const blockchainConfig = registerAs(
  'blockchain',
  (): IBlockchainConfig => ({
    enabled: process.env.BLOCKCHAIN_WORKER_ENABLED === 'true',
    pollIntervalMs: Number(process.env.BLOCKCHAIN_POLL_INTERVAL_MS ?? 5_000),
    leaseDurationMs: Number(process.env.BLOCKCHAIN_LEASE_DURATION_MS ?? 30_000),
    retryBaseDelayMs: Number(
      process.env.BLOCKCHAIN_RETRY_BASE_DELAY_MS ?? 5_000,
    ),
    channelName: process.env.FABRIC_CHANNEL_NAME ?? 'farm2forkchannel',
    chaincodeName: process.env.FABRIC_CHAINCODE_NAME ?? 'farm2fork-chaincode',
    mspId: process.env.FABRIC_MSP_ID ?? 'Farm2ForkMSP',
    peerEndpoint: process.env.FABRIC_PEER_ENDPOINT ?? 'peer0.farm2fork.com:7051',
    peerHostAlias: process.env.FABRIC_PEER_HOST_ALIAS ?? 'peer0.farm2fork.com',
    tlsRootCertPath: process.env.FABRIC_TLS_ROOT_CERT_PATH,
    identityCertPath: process.env.FABRIC_IDENTITY_CERT_PATH,
    identityKeyPath: process.env.FABRIC_IDENTITY_KEY_PATH,
  }),
);
