import { ConfigService } from '@nestjs/config';

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

export const blockchainConfig = (): IBlockchainConfig => {
  const configService = new ConfigService();

  return {
    enabled: configService.get('BLOCKCHAIN_WORKER_ENABLED', false),
    pollIntervalMs: configService.get('BLOCKCHAIN_POLL_INTERVAL_MS', 5_000),
    leaseDurationMs: configService.get('BLOCKCHAIN_LEASE_DURATION_MS', 30_000),
    retryBaseDelayMs: configService.get(
      'BLOCKCHAIN_RETRY_BASE_DELAY_MS',
      5_000,
    ),
    channelName: configService.get('FABRIC_CHANNEL_NAME', 'farm2forkchannel'),
    chaincodeName: configService.get('FABRIC_CHAINCODE_NAME', 'farm2fork'),
    mspId: configService.get('FABRIC_MSP_ID', 'Org1MSP'),
    peerEndpoint: configService.get('FABRIC_PEER_ENDPOINT', 'localhost:7051'),
    peerHostAlias: configService.get(
      'FABRIC_PEER_HOST_ALIAS',
      'peer0.org1.example.com',
    ),
    tlsRootCertPath: configService.get('FABRIC_TLS_ROOT_CERT_PATH'),
    identityCertPath: configService.get('FABRIC_IDENTITY_CERT_PATH'),
    identityKeyPath: configService.get('FABRIC_IDENTITY_KEY_PATH'),
  };
};
