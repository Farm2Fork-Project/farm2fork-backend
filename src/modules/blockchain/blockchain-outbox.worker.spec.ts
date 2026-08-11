import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import {
  FABRIC_GATEWAY_CLIENT,
  FabricGatewayClient,
  FabricGatewayFailure,
} from './interfaces/fabric-gateway-client.interface';
import { BlockchainOutboxWorker } from './blockchain-outbox.worker';
import {
  BlockchainTransaction,
  BlockchainTxStatus,
} from './schemas/blockchain-transaction.schema';

describe('BlockchainOutboxWorker', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const outboxId = new Types.ObjectId();
  const model = { findOneAndUpdate: jest.fn(), updateOne: jest.fn() };
  const gateway: jest.Mocked<FabricGatewayClient> = {
    findByLedgerKey: jest.fn(),
    submit: jest.fn(),
  };
  const config = {
    getOrThrow: jest.fn(
      (key: string) =>
        ({
          'blockchain.leaseDurationMs': 30_000,
          'blockchain.retryBaseDelayMs': 5_000,
        })[key],
    ),
  } as unknown as ConfigService;
  const worker = new BlockchainOutboxWorker(model as never, config, gateway);

  beforeEach(() => jest.clearAllMocks());

  it('leases only an expired-or-unleased pending record below the retry limit', async () => {
    model.findOneAndUpdate.mockResolvedValue(null);

    await worker.processNext(now);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: BlockchainTxStatus.Pending,
        retryCount: { $lt: 3 },
        $and: expect.any(Array),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          leaseToken: expect.any(String),
          lastAttemptAt: now,
          leaseExpiresAt: new Date(now.getTime() + 30_000),
        }),
      }),
      { sort: { createdAt: 1 }, new: true },
    );
  });

  it('confirms an existing Fabric ledger key without submitting again', async () => {
    const record = pendingRecord();
    model.findOneAndUpdate.mockResolvedValue(record);
    model.updateOne.mockResolvedValue({});
    gateway.findByLedgerKey.mockResolvedValue({
      ledgerKey: outboxId.toHexString(),
      referenceId: record.referenceId.toHexString(),
      referenceModel: 'Shipment',
      txHash: 'fabric-existing-001',
      blockNumber: 24,
      channelName: 'farm2forkchannel',
    });

    await worker.processNext(now);

    expect(gateway.submit).not.toHaveBeenCalled();
    expect(model.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: outboxId,
        leaseToken: expect.any(String),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: BlockchainTxStatus.Confirmed,
          txHash: 'fabric-existing-001',
          blockNumber: 24,
          channelName: 'farm2forkchannel',
          confirmedAt: now,
        }),
      }),
    );
  });

  it('fails permanent errors and schedules transient retries', async () => {
    const record = pendingRecord();
    model.findOneAndUpdate.mockResolvedValue(record);
    model.updateOne.mockResolvedValue({});
    gateway.findByLedgerKey.mockResolvedValue(null);
    gateway.submit.mockRejectedValueOnce(
      new FabricGatewayFailure(
        'permanent',
        'ledger_conflict',
        'immutable conflict',
      ),
    );

    await worker.processNext(now);

    expect(model.updateOne).toHaveBeenLastCalledWith(
      expect.objectContaining({ leaseToken: expect.any(String) }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: BlockchainTxStatus.Failed,
          lastErrorCode: 'ledger_conflict',
        }),
      }),
    );

    gateway.submit.mockRejectedValueOnce(
      new FabricGatewayFailure(
        'transient',
        'fabric_unavailable',
        'peer offline',
      ),
    );
    await worker.processNext(now);

    expect(model.updateOne).toHaveBeenLastCalledWith(
      expect.objectContaining({ leaseToken: expect.any(String) }),
      expect.objectContaining({
        $inc: { retryCount: 1 },
        $set: expect.objectContaining({
          status: BlockchainTxStatus.Pending,
          nextAttemptAt: new Date(now.getTime() + 5_000),
        }),
      }),
    );
  });

  function pendingRecord() {
    return {
      _id: outboxId,
      referenceId: new Types.ObjectId(),
      retryCount: 0,
      leaseToken: 'lease-001',
    };
  }
});
