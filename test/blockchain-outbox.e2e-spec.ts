import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { BlockchainOutboxWorker } from '../src/modules/blockchain/blockchain-outbox.worker';
import {
  FABRIC_GATEWAY_CLIENT,
  FabricGatewayClient,
} from '../src/modules/blockchain/interfaces/fabric-gateway-client.interface';
import {
  BlockchainReferenceModel,
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTransactionSchema,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../src/modules/blockchain/schemas/blockchain-transaction.schema';

describe('BlockchainOutboxWorker integration', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const config = {
    get: jest.fn().mockReturnValue(false),
    getOrThrow: jest.fn(
      (key: string) =>
        ({
          'blockchain.leaseDurationMs': 30_000,
          'blockchain.retryBaseDelayMs': 5_000,
        })[key],
    ),
  } as unknown as ConfigService;
  const gateway: jest.Mocked<FabricGatewayClient> = {
    findByLedgerKey: jest.fn(),
    submit: jest.fn(),
  };
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let workerA: BlockchainOutboxWorker;
  let blockchainModel: Model<BlockchainTransactionDocument>;
  let connection: Connection;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(replSet.getUri()),
        MongooseModule.forFeature([
          {
            name: BlockchainTransaction.name,
            schema: BlockchainTransactionSchema,
          },
        ]),
      ],
      providers: [
        BlockchainOutboxWorker,
        { provide: ConfigService, useValue: config },
        { provide: FABRIC_GATEWAY_CLIENT, useValue: gateway },
      ],
    }).compile();

    workerA = moduleRef.get(BlockchainOutboxWorker);
    blockchainModel = moduleRef.get(getModelToken(BlockchainTransaction.name));
    connection = moduleRef.get(getConnectionToken());
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await blockchainModel.deleteMany({});
  });

  afterAll(async () => {
    await connection.close();
    await moduleRef.close();
    await replSet.stop();
  });

  it('allows only one concurrent worker to submit an eligible outbox record', async () => {
    const record = await createPendingPayment();
    const workerB = new BlockchainOutboxWorker(
      blockchainModel,
      config,
      gateway,
    );
    gateway.findByLedgerKey.mockResolvedValue(null);
    gateway.submit.mockResolvedValue({
      txHash: 'fabric-outbox-001',
      blockNumber: 24,
      channelName: 'farm2forkchannel',
    });

    await Promise.all([workerA.processNext(now), workerB.processNext(now)]);

    expect(gateway.submit).toHaveBeenCalledTimes(1);
    await expect(
      blockchainModel.findById(record.id).lean().exec(),
    ).resolves.toMatchObject({
      status: BlockchainTxStatus.Confirmed,
      txHash: 'fabric-outbox-001',
      blockNumber: 24,
      channelName: 'farm2forkchannel',
    });
  });

  it('confirms an existing Fabric ledger key without resubmitting the outbox record', async () => {
    const record = await createPendingPayment();
    gateway.findByLedgerKey.mockResolvedValue({
      ledgerKey: record.id,
      referenceId: record.referenceId.toHexString(),
      referenceModel: BlockchainReferenceModel.Payment,
      txHash: 'fabric-existing-001',
      blockNumber: 25,
      channelName: 'farm2forkchannel',
    });

    await workerA.processNext(now);

    expect(gateway.findByLedgerKey).toHaveBeenCalledWith(record.id);
    expect(gateway.submit).not.toHaveBeenCalled();
    await expect(
      blockchainModel.findById(record.id).lean().exec(),
    ).resolves.toMatchObject({
      status: BlockchainTxStatus.Confirmed,
      txHash: 'fabric-existing-001',
      blockNumber: 25,
      channelName: 'farm2forkchannel',
    });
  });

  async function createPendingPayment(): Promise<BlockchainTransactionDocument> {
    return blockchainModel.create({
      type: BlockchainTxType.Payment,
      referenceId: new Types.ObjectId(),
      referenceModel: BlockchainReferenceModel.Payment,
      payload: {
        payment: {
          orderId: new Types.ObjectId(),
          buyerId: new Types.ObjectId(),
          farmerId: new Types.ObjectId(),
          amount: 1500,
          currency: 'PKR',
          gateway: 'integration',
          paidAt: now,
        },
        supplyChain: null,
      },
      status: BlockchainTxStatus.Pending,
    });
  }
});
