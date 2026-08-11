import { BlockchainTransactionDocument } from '../schemas/blockchain-transaction.schema';

export const FABRIC_GATEWAY_CLIENT = Symbol('FABRIC_GATEWAY_CLIENT');
export const FABRIC_GATEWAY_RUNTIME = Symbol('FABRIC_GATEWAY_RUNTIME');

export interface FabricLedgerRecord {
  ledgerKey: string;
  referenceId: string;
  referenceModel: string;
  productId?: string;
  txHash?: string;
  blockNumber?: number;
  channelName?: string;
}

export interface FabricCommit {
  txHash: string;
  blockNumber: number;
  channelName: string;
}

export interface FabricGatewayStatus {
  successful: boolean;
  transactionId: string;
  blockNumber: bigint;
}

export interface FabricSubmittedTransaction {
  getStatus(): Promise<FabricGatewayStatus>;
}

export interface FabricContract {
  evaluateTransaction(
    name: string,
    ...arguments_: string[]
  ): Promise<Uint8Array>;
  submitAsync(
    name: string,
    options: { arguments: string[] },
  ): Promise<FabricSubmittedTransaction>;
}

export interface FabricGatewayRuntime {
  connect(): Promise<FabricContract>;
  close(): void;
}

export interface FabricGatewayClient {
  findByLedgerKey(ledgerKey: string): Promise<FabricLedgerRecord | null>;
  submit(record: BlockchainTransactionDocument): Promise<FabricCommit>;
}

export type FabricFailureKind = 'permanent' | 'transient';
export type FabricFailureCode =
  | 'invalid_payload'
  | 'ledger_conflict'
  | 'fabric_validation'
  | 'fabric_unavailable';

export class FabricGatewayFailure extends Error {
  constructor(
    readonly kind: FabricFailureKind,
    readonly code: FabricFailureCode,
    message: string,
  ) {
    super(message);
    this.name = FabricGatewayFailure.name;
  }
}
