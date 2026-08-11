import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import { connect, Gateway, signers } from '@hyperledger/fabric-gateway';
import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  FabricContract,
  FabricGatewayRuntime,
} from './interfaces/fabric-gateway-client.interface';

/**
 * Owns the actual gRPC/TLS connection. It is intentionally separate from the
 * outbox mapping service so unit tests never load the SDK's ESM crypto stack.
 */
@Injectable()
export class FabricGatewayRuntimeService implements FabricGatewayRuntime {
  private client?: grpc.Client;
  private gateway?: Gateway;

  constructor(private readonly config: ConfigService) {}

  async connect(): Promise<FabricContract> {
    const tlsRootCertPath = this.config.getOrThrow<string>(
      'blockchain.tlsRootCertPath',
    );
    const identityCertPath = this.config.getOrThrow<string>(
      'blockchain.identityCertPath',
    );
    const identityKeyPath = this.config.getOrThrow<string>(
      'blockchain.identityKeyPath',
    );
    const [tlsRootCert, identityCert, identityKey] = await Promise.all([
      readFile(tlsRootCertPath),
      readFile(identityCertPath),
      readFile(identityKeyPath),
    ]);
    const peerEndpoint = this.config.getOrThrow<string>(
      'blockchain.peerEndpoint',
    );
    const peerHostAlias = this.config.getOrThrow<string>(
      'blockchain.peerHostAlias',
    );
    const channelName = this.config.getOrThrow<string>(
      'blockchain.channelName',
    );
    const chaincodeName = this.config.getOrThrow<string>(
      'blockchain.chaincodeName',
    );
    const mspId = this.config.getOrThrow<string>('blockchain.mspId');

    this.client = new grpc.Client(
      peerEndpoint,
      grpc.credentials.createSsl(tlsRootCert),
      { 'grpc.ssl_target_name_override': peerHostAlias },
    );
    this.gateway = connect({
      client: this.client,
      identity: { mspId, credentials: identityCert },
      signer: signers.newPrivateKeySigner(createPrivateKey(identityKey)),
    });
    return this.gateway.getNetwork(channelName).getContract(chaincodeName);
  }

  close(): void {
    this.gateway?.close();
    this.client?.close();
  }
}
