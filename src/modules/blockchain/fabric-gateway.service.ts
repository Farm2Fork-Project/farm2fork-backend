import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BlockchainReferenceModel,
  BlockchainTransactionDocument,
  BlockchainTxType,
} from './schemas/blockchain-transaction.schema';
import {
  FabricGatewayFailure,
  FABRIC_GATEWAY_RUNTIME,
} from './interfaces/fabric-gateway-client.interface';
import type {
  FabricCommit,
  FabricContract,
  FabricGatewayClient,
  FabricLedgerRecord,
  FabricGatewayRuntime,
} from './interfaces/fabric-gateway-client.interface';

const decoder = new TextDecoder();

@Injectable()
export class FabricGatewayService
  implements FabricGatewayClient, OnModuleInit, OnModuleDestroy
{
  private contract?: FabricContract;

  constructor(
    private readonly config: ConfigService,
    @Inject(FABRIC_GATEWAY_RUNTIME)
    private readonly runtime: FabricGatewayRuntime,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get<boolean>('blockchain.enabled', false)) {
      return;
    }

    this.contract = await this.runtime.connect();
  }

  onModuleDestroy(): void {
    this.runtime.close();
  }

  async findByLedgerKey(ledgerKey: string): Promise<FabricLedgerRecord | null> {
    try {
      const result = await this.requireContract().evaluateTransaction(
        'GetTransactionByLedgerKey',
        ledgerKey,
      );
      return this.parseLedgerRecord(result);
    } catch (error) {
      if (isFabricNotFound(error)) {
        return null;
      }
      throw classifyFabricError(error);
    }
  }

  async submit(record: BlockchainTransactionDocument): Promise<FabricCommit> {
    const submission = this.toSubmission(record);

    try {
      const submitted = await this.requireContract().submitAsync(
        submission.name,
        { arguments: submission.arguments },
      );
      const status = await submitted.getStatus();
      if (!status.successful) {
        throw new FabricGatewayFailure(
          'permanent',
          'fabric_validation',
          'Fabric rejected the transaction during commit validation',
        );
      }

      return {
        txHash: status.transactionId,
        blockNumber: Number(status.blockNumber),
        channelName: this.config.getOrThrow<string>('blockchain.channelName'),
      };
    } catch (error) {
      throw classifyFabricError(error);
    }
  }

  private requireContract(): FabricContract {
    if (!this.contract) {
      throw new FabricGatewayFailure(
        'transient',
        'fabric_unavailable',
        'Fabric gateway is not initialized',
      );
    }
    return this.contract;
  }

  private parseLedgerRecord(result: Uint8Array): FabricLedgerRecord {
    try {
      const record: unknown = JSON.parse(decoder.decode(result));
      if (
        !record ||
        typeof record !== 'object' ||
        typeof (record as FabricLedgerRecord).ledgerKey !== 'string'
      ) {
        throw new Error('Fabric response does not contain a ledger key');
      }
      return record as FabricLedgerRecord;
    } catch (error) {
      throw new FabricGatewayFailure(
        'permanent',
        'fabric_validation',
        error instanceof Error ? error.message : 'Invalid Fabric response',
      );
    }
  }

  private toSubmission(record: BlockchainTransactionDocument): {
    name: 'RecordPayment' | 'RecordSupplyChainEvent';
    arguments: string[];
  } {
    const ledgerKey = record._id.toHexString();
    const referenceId = record.referenceId.toHexString();

    if (record.type === BlockchainTxType.Payment) {
      const payment = record.payload.payment;
      if (
        !payment?.orderId ||
        !payment.buyerId ||
        !payment.farmerId ||
        payment.amount === undefined ||
        !payment.currency ||
        !payment.gateway ||
        !payment.paidAt
      ) {
        throw invalidPayload('Payment outbox record is incomplete');
      }
      return {
        name: 'RecordPayment',
        arguments: [
          ledgerKey,
          referenceId,
          payment.orderId.toHexString(),
          payment.buyerId.toHexString(),
          payment.farmerId.toHexString(),
          String(payment.amount),
          payment.currency,
          payment.gateway,
          payment.paidAt.toISOString(),
        ],
      };
    }

    const supplyChain = record.payload.supplyChain;
    if (
      record.type !== BlockchainTxType.SupplyChainEvent ||
      record.referenceModel !== BlockchainReferenceModel.Shipment ||
      !supplyChain?.productId ||
      !supplyChain.farmerId ||
      !supplyChain.eventType ||
      !supplyChain.location ||
      !supplyChain.actorId ||
      !supplyChain.actorRole ||
      !supplyChain.timestamp
    ) {
      throw invalidPayload('Supply-chain outbox record is incomplete');
    }
    return {
      name: 'RecordSupplyChainEvent',
      arguments: [
        ledgerKey,
        referenceId,
        record.referenceModel,
        supplyChain.productId.toHexString(),
        supplyChain.farmerId.toHexString(),
        supplyChain.eventType,
        supplyChain.location,
        supplyChain.actorId.toHexString(),
        supplyChain.actorRole,
        supplyChain.timestamp.toISOString(),
      ],
    };
  }
}

function invalidPayload(message: string): FabricGatewayFailure {
  return new FabricGatewayFailure('permanent', 'invalid_payload', message);
}

function isFabricNotFound(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('not found') ||
    message.includes('no such key')
  );
}

function classifyFabricError(error: unknown): FabricGatewayFailure {
  if (error instanceof FabricGatewayFailure) {
    return error;
  }

  const message = errorMessage(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes('unavailable') ||
    normalized.includes('deadline exceeded') ||
    normalized.includes('deadline_exceeded') ||
    normalized.includes('14 unavailable')
  ) {
    return new FabricGatewayFailure('transient', 'fabric_unavailable', message);
  }
  if (
    normalized.includes('ledger key already exists') ||
    normalized.includes('mvcc_read_conflict') ||
    normalized.includes('mvcc read conflict')
  ) {
    return new FabricGatewayFailure('permanent', 'ledger_conflict', message);
  }
  return new FabricGatewayFailure('permanent', 'fabric_validation', message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Fabric request failed';
}
