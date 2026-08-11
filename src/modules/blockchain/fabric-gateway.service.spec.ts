import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import {
  BlockchainReferenceModel,
  BlockchainTransactionDocument,
  BlockchainTxStatus,
  BlockchainTxType,
} from './schemas/blockchain-transaction.schema';
import {
  FabricContract,
  FabricGatewayFailure,
  FabricGatewayRuntime,
} from './interfaces/fabric-gateway-client.interface';
import { FabricGatewayService } from './fabric-gateway.service';

describe('FabricGatewayService', () => {
  const contract: jest.Mocked<FabricContract> = {
    evaluateTransaction: jest.fn(),
    submitAsync: jest.fn(),
  };
  const config = {
    get: jest.fn().mockReturnValue(true),
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        'blockchain.channelName': 'farm2forkchannel',
        'blockchain.chaincodeName': 'farm2fork',
        'blockchain.mspId': 'Farm2ForkMSP',
      };
      return values[key];
    }),
  } as unknown as ConfigService;
  const runtime: jest.Mocked<FabricGatewayRuntime> = {
    connect: jest.fn(),
    close: jest.fn(),
  };
  let service: FabricGatewayService;

  beforeEach(async () => {
    jest.clearAllMocks();
    runtime.connect.mockResolvedValue(contract);
    service = new FabricGatewayService(config, runtime);
    await service.onModuleInit();
  });

  it('maps a payment outbox record to immutable ledger arguments', async () => {
    const paidAt = new Date('2026-08-11T12:00:00.000Z');
    const record = paymentRecord({ paidAt });
    const submitted = {
      getStatus: jest.fn().mockResolvedValue({
        successful: true,
        transactionId: 'fabric-payment-001',
        blockNumber: 18n,
      }),
    };
    contract.submitAsync.mockResolvedValue(submitted);

    await expect(service.submit(record)).resolves.toEqual({
      txHash: 'fabric-payment-001',
      blockNumber: 18,
      channelName: 'farm2forkchannel',
    });

    expect(contract.submitAsync).toHaveBeenCalledWith('RecordPayment', {
      arguments: [
        record._id.toHexString(),
        record.referenceId.toHexString(),
        record.payload.payment?.orderId?.toHexString(),
        record.payload.payment?.buyerId?.toHexString(),
        record.payload.payment?.farmerId?.toHexString(),
        '1500',
        'PKR',
        'stripe',
        paidAt.toISOString(),
      ],
      endorsingOrganizations: ['Farm2ForkMSP'],
    });
  });

  it('maps a shipment product event to immutable ledger arguments', async () => {
    const timestamp = new Date('2026-08-11T12:05:00.000Z');
    const record = shipmentRecord({ timestamp });
    contract.submitAsync.mockResolvedValue({
      getStatus: jest.fn().mockResolvedValue({
        successful: true,
        transactionId: 'fabric-shipment-001',
        blockNumber: 19n,
      }),
    });

    await service.submit(record);

    expect(contract.submitAsync).toHaveBeenCalledWith(
      'RecordSupplyChainEvent',
      {
        arguments: [
          record._id.toHexString(),
          record.referenceId.toHexString(),
          'Shipment',
          record.payload.supplyChain?.productId?.toHexString(),
          record.payload.supplyChain?.farmerId?.toHexString(),
          'shipment_in_transit',
          'Lahore, Punjab',
          record.payload.supplyChain?.actorId?.toHexString(),
          'transporter',
          timestamp.toISOString(),
        ],
        endorsingOrganizations: ['Farm2ForkMSP'],
      },
    );
  });

  it('rejects incomplete payloads before calling Fabric', async () => {
    const record = paymentRecord();
    record.payload.payment = null;

    await expect(service.submit(record)).rejects.toEqual(
      expect.objectContaining<FabricGatewayFailure>({
        kind: 'permanent',
        code: 'invalid_payload',
      }),
    );
    expect(contract.submitAsync).not.toHaveBeenCalled();
  });

  it('maps Fabric missing ledger-key responses to null', async () => {
    contract.evaluateTransaction.mockRejectedValue(
      new Error('ledger key does not exist'),
    );

    await expect(
      service.findByLedgerKey('missing-outbox-key'),
    ).resolves.toBeNull();
  });

  it('classifies transient Fabric availability failures', async () => {
    const record = paymentRecord();
    contract.submitAsync.mockRejectedValue(
      new Error('14 UNAVAILABLE: peer offline'),
    );

    await expect(service.submit(record)).rejects.toEqual(
      expect.objectContaining<FabricGatewayFailure>({
        kind: 'transient',
        code: 'fabric_unavailable',
      }),
    );
  });

  it('classifies immutable ledger conflicts as permanent', async () => {
    const record = paymentRecord();
    contract.submitAsync.mockRejectedValue(
      new Error('ledger key already exists with different immutable content'),
    );

    await expect(service.submit(record)).rejects.toEqual(
      expect.objectContaining<FabricGatewayFailure>({
        kind: 'permanent',
        code: 'ledger_conflict',
      }),
    );
  });
});

function paymentRecord(
  overrides: Partial<{ paidAt: Date }> = {},
): BlockchainTransactionDocument {
  return {
    _id: new Types.ObjectId(),
    type: BlockchainTxType.Payment,
    referenceId: new Types.ObjectId(),
    referenceModel: BlockchainReferenceModel.Payment,
    status: BlockchainTxStatus.Pending,
    payload: {
      payment: {
        orderId: new Types.ObjectId(),
        buyerId: new Types.ObjectId(),
        farmerId: new Types.ObjectId(),
        amount: 1500,
        currency: 'PKR',
        gateway: 'stripe',
        paidAt: overrides.paidAt ?? new Date('2026-08-11T12:00:00.000Z'),
      },
      supplyChain: null,
    },
  } as unknown as BlockchainTransactionDocument;
}

function shipmentRecord(
  overrides: Partial<{ timestamp: Date }> = {},
): BlockchainTransactionDocument {
  return {
    _id: new Types.ObjectId(),
    type: BlockchainTxType.SupplyChainEvent,
    referenceId: new Types.ObjectId(),
    referenceModel: BlockchainReferenceModel.Shipment,
    status: BlockchainTxStatus.Pending,
    payload: {
      payment: null,
      supplyChain: {
        productId: new Types.ObjectId(),
        farmerId: new Types.ObjectId(),
        eventType: 'shipment_in_transit',
        location: 'Lahore, Punjab',
        actorId: new Types.ObjectId(),
        actorRole: 'transporter',
        timestamp: overrides.timestamp ?? new Date('2026-08-11T12:05:00.000Z'),
      },
    },
  } as unknown as BlockchainTransactionDocument;
}
