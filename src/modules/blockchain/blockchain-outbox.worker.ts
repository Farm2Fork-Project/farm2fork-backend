import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import {
  FABRIC_GATEWAY_CLIENT,
  FabricGatewayFailure,
} from './interfaces/fabric-gateway-client.interface';
import type { FabricGatewayClient } from './interfaces/fabric-gateway-client.interface';
import {
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTxStatus,
} from './schemas/blockchain-transaction.schema';

const MAX_RETRIES = 3;
const MAX_ERROR_MESSAGE_LENGTH = 500;

@Injectable()
export class BlockchainOutboxWorker {
  constructor(
    @InjectModel(BlockchainTransaction.name)
    private readonly model: Model<BlockchainTransactionDocument>,
    private readonly config: ConfigService,
    @Inject(FABRIC_GATEWAY_CLIENT)
    private readonly gateway: FabricGatewayClient,
  ) {}

  async processNext(now = new Date()): Promise<boolean> {
    const leaseToken = randomUUID();
    const leaseDurationMs = this.config.getOrThrow<number>(
      'blockchain.leaseDurationMs',
    );
    const record = await this.model.findOneAndUpdate(
      {
        status: BlockchainTxStatus.Pending,
        retryCount: { $lt: MAX_RETRIES },
        $and: [
          {
            $or: [
              { nextAttemptAt: { $exists: false } },
              { nextAttemptAt: { $lte: now } },
            ],
          },
          {
            $or: [
              { leaseExpiresAt: { $exists: false } },
              { leaseExpiresAt: { $lte: now } },
            ],
          },
        ],
      },
      {
        $set: {
          leaseToken,
          lastAttemptAt: now,
          leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        },
      },
      { sort: { createdAt: 1 }, new: true },
    );
    if (!record) return false;

    try {
      const existing = await this.gateway.findByLedgerKey(
        record._id.toHexString(),
      );
      const commit = existing ?? (await this.gateway.submit(record));
      await this.confirm(record, leaseToken, commit, now);
    } catch (error) {
      await this.handleFailure(record, leaseToken, error, now);
    }
    return true;
  }

  private async confirm(
    record: BlockchainTransactionDocument,
    leaseToken: string,
    commit: { txHash?: string; blockNumber?: number; channelName?: string },
    now: Date,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: record._id, leaseToken },
      {
        $set: {
          status: BlockchainTxStatus.Confirmed,
          txHash: commit.txHash,
          blockNumber: commit.blockNumber,
          channelName: commit.channelName,
          confirmedAt: now,
        },
        $unset: this.clearLeaseAndErrors(),
      },
    );
  }

  private async handleFailure(
    record: BlockchainTransactionDocument,
    leaseToken: string,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const failure = this.failureFrom(error);
    if (failure.kind === 'permanent' || record.retryCount + 1 >= MAX_RETRIES) {
      await this.model.updateOne(
        { _id: record._id, leaseToken },
        {
          $set: {
            status: BlockchainTxStatus.Failed,
            lastErrorCode: failure.code,
            lastErrorMessage: failure.message.slice(
              0,
              MAX_ERROR_MESSAGE_LENGTH,
            ),
          },
          $unset: this.clearLease(),
        },
      );
      return;
    }

    const baseDelay = this.config.getOrThrow<number>(
      'blockchain.retryBaseDelayMs',
    );
    await this.model.updateOne(
      { _id: record._id, leaseToken },
      {
        $inc: { retryCount: 1 },
        $set: {
          status: BlockchainTxStatus.Pending,
          nextAttemptAt: new Date(
            now.getTime() + baseDelay * 2 ** record.retryCount,
          ),
          lastErrorCode: failure.code,
          lastErrorMessage: failure.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
        },
        $unset: this.clearLease(),
      },
    );
  }

  private failureFrom(error: unknown): FabricGatewayFailure {
    if (error instanceof FabricGatewayFailure) return error;
    return new FabricGatewayFailure(
      'transient',
      'fabric_unavailable',
      error instanceof Error ? error.message : 'Fabric request failed',
    );
  }

  private clearLease(): Record<string, 1> {
    return { leaseToken: 1, leaseExpiresAt: 1 };
  }

  private clearLeaseAndErrors(): Record<string, 1> {
    return {
      ...this.clearLease(),
      lastErrorCode: 1,
      lastErrorMessage: 1,
      nextAttemptAt: 1,
    };
  }
}
