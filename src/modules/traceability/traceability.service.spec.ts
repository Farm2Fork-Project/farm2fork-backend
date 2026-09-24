import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { FarmerProfile } from '../auth/schemas/farmer-profile.schema';
import { FABRIC_GATEWAY_CLIENT } from '../blockchain/interfaces/fabric-gateway-client.interface';
import {
  BlockchainReferenceModel,
  BlockchainTransaction,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../blockchain/schemas/blockchain-transaction.schema';
import {
  Product,
  ProductStatus,
  ProductUnit,
  QualityGrade,
} from '../marketplace/schemas/product.schema';
import { Order } from '../order/schemas/order.schema';
import {
  LedgerCheckState,
  OnChainCheck,
  TraceEventType,
  TraceLedgerStatus,
} from './dto/product-trace-response.dto';
import { TraceabilityService, shortReference } from './traceability.service';

const PRODUCT_ID = new Types.ObjectId('6a2fe77bb77795516febc287');
const FARMER_ID = new Types.ObjectId('6a2fe77bb77795516febc111');
const BUYER_ID = new Types.ObjectId('6a2fe77bb77795516febc333');
const SHIPMENT_ID = new Types.ObjectId('6a2fe77bb77795516febcaaa');
const PAYMENT_ID = new Types.ObjectId('6a2fe77bb77795516febcbbb');

function query<T>(result: T) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function supplyChainRecord(
  eventType: string,
  timestamp: string,
  overrides: Record<string, unknown> = {},
) {
  const isListed = eventType === 'listed';
  return {
    _id: new Types.ObjectId(),
    type: BlockchainTxType.SupplyChainEvent,
    referenceId: isListed ? PRODUCT_ID : SHIPMENT_ID,
    referenceModel: isListed
      ? BlockchainReferenceModel.Product
      : BlockchainReferenceModel.Shipment,
    status: BlockchainTxStatus.Pending,
    createdAt: new Date(timestamp),
    payload: {
      payment: null,
      supplyChain: {
        productId: PRODUCT_ID,
        farmerId: FARMER_ID,
        eventType,
        location: isListed ? 'Multan, Punjab' : 'Lahore, Punjab',
        actorId: FARMER_ID,
        actorRole: isListed ? 'farmer' : 'transporter',
        timestamp: new Date(timestamp),
      },
    },
    ...overrides,
  };
}

describe('TraceabilityService', () => {
  let service: TraceabilityService;
  let productModel: { findById: jest.Mock };
  let orderModel: { find: jest.Mock };
  let blockchainModel: { find: jest.Mock };
  let farmerProfileModel: { findOne: jest.Mock };
  let fabric: { isAvailable: jest.Mock; findByLedgerKey: jest.Mock };

  beforeEach(async () => {
    productModel = {
      findById: jest.fn().mockReturnValue(
        query({
          id: PRODUCT_ID.toHexString(),
          farmerId: FARMER_ID,
          name: 'Chaunsa Mangoes',
          category: 'fruits',
          unit: ProductUnit.Kg,
          qualityGrade: QualityGrade.A,
          status: ProductStatus.Active,
          images: ['https://cdn.example/mango.jpg'],
          createdAt: new Date('2026-08-11T11:00:00.000Z'),
        }),
      ),
    };
    orderModel = { find: jest.fn().mockReturnValue(query([])) };
    blockchainModel = { find: jest.fn().mockReturnValue(query([])) };
    farmerProfileModel = {
      findOne: jest.fn().mockReturnValue(
        query({
          farmName: 'Green Valley Farm',
          farmLocation: { city: 'Multan', province: 'Punjab' },
        }),
      ),
    };

    fabric = {
      isAvailable: jest.fn().mockReturnValue(false),
      findByLedgerKey: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TraceabilityService,
        { provide: FABRIC_GATEWAY_CLIENT, useValue: fabric },
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
        {
          provide: getModelToken(BlockchainTransaction.name),
          useValue: blockchainModel,
        },
        {
          provide: getModelToken(FarmerProfile.name),
          useValue: farmerProfileModel,
        },
      ],
    }).compile();

    service = moduleRef.get(TraceabilityService);
  });

  it('throws NotFound for a malformed id without querying', async () => {
    await expect(service.traceProduct('not-an-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(productModel.findById).not.toHaveBeenCalled();
  });

  it('throws NotFound when the product does not exist', async () => {
    productModel.findById.mockReturnValue(query(null));
    await expect(
      service.traceProduct(PRODUCT_ID.toHexString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the product, farm and a chronological, ledger-annotated journey', async () => {
    const listed = supplyChainRecord('listed', '2026-08-11T11:00:00.000Z', {
      status: BlockchainTxStatus.Confirmed,
      txHash: 'fabric-listed-001',
      blockNumber: 7,
      channelName: 'farm2forkchannel',
      confirmedAt: new Date('2026-08-11T11:00:04.000Z'),
    });
    const inTransit = supplyChainRecord(
      'shipment_in_transit',
      '2026-08-12T09:00:00.000Z',
    );
    blockchainModel.find
      .mockReturnValueOnce(query([listed, inTransit]))
      .mockReturnValueOnce(
        query([
          {
            _id: new Types.ObjectId(),
            type: BlockchainTxType.Payment,
            referenceId: PAYMENT_ID,
            referenceModel: BlockchainReferenceModel.Payment,
            status: BlockchainTxStatus.Failed,
            createdAt: new Date('2026-08-11T15:00:00.000Z'),
            payload: {
              supplyChain: null,
              payment: {
                buyerId: BUYER_ID,
                amount: 45000,
                currency: 'PKR',
                gateway: 'stripe',
                paidAt: new Date('2026-08-11T15:00:00.000Z'),
              },
            },
          },
        ]),
      );
    orderModel.find.mockReturnValue(query([{ paymentId: PAYMENT_ID }]));

    const trace = await service.traceProduct(PRODUCT_ID.toHexString());

    expect(trace.product).toMatchObject({
      name: 'Chaunsa Mangoes',
      imageUrl: 'https://cdn.example/mango.jpg',
      listedAt: '2026-08-11T11:00:00.000Z',
    });
    expect(trace.farmer).toEqual({
      farmName: 'Green Valley Farm',
      city: 'Multan',
      province: 'Punjab',
    });
    expect(trace.events.map((event) => event.type)).toEqual([
      TraceEventType.Listed,
      TraceEventType.PaymentConfirmed,
      TraceEventType.ShipmentInTransit,
    ]);
    expect(trace.events[0].ledger).toEqual({
      status: TraceLedgerStatus.Confirmed,
      txHash: 'fabric-listed-001',
      blockNumber: 7,
      channelName: 'farm2forkchannel',
      confirmedAt: '2026-08-11T11:00:04.000Z',
    });
    expect(trace.events[0].reference).toBeUndefined();
    expect(trace.events[1].ledger).toEqual({
      status: TraceLedgerStatus.Failed,
    });
    expect(trace.events[2]).toMatchObject({
      location: 'Lahore, Punjab',
      reference: shortReference(SHIPMENT_ID),
      ledger: { status: TraceLedgerStatus.Pending },
    });
    expect(trace.summary).toEqual({
      totalEvents: 3,
      confirmedEvents: 1,
      originVerified: true,
      ledgerCheck: LedgerCheckState.Unavailable,
    });
    // Without a peer connection nothing is claimed as re-read from Fabric.
    expect(trace.events[0].ledger.onChain).toBeUndefined();
  });

  it('never leaks payment amounts, buyer ids or actor ids', async () => {
    blockchainModel.find
      .mockReturnValueOnce(
        query([
          supplyChainRecord('shipment_delivered', '2026-08-13T10:00:00Z'),
        ]),
      )
      .mockReturnValueOnce(
        query([
          {
            _id: new Types.ObjectId(),
            type: BlockchainTxType.Payment,
            referenceId: PAYMENT_ID,
            status: BlockchainTxStatus.Pending,
            createdAt: new Date('2026-08-11T15:00:00.000Z'),
            payload: {
              supplyChain: null,
              payment: { buyerId: BUYER_ID, amount: 45000, gateway: 'stripe' },
            },
          },
        ]),
      );
    orderModel.find.mockReturnValue(query([{ paymentId: PAYMENT_ID }]));

    const serialized = JSON.stringify(
      await service.traceProduct(PRODUCT_ID.toHexString()),
    );

    expect(serialized).not.toContain(BUYER_ID.toHexString());
    expect(serialized).not.toContain(FARMER_ID.toHexString());
    expect(serialized).not.toContain('45000');
    expect(serialized).not.toContain('stripe');
    expect(serialized).not.toContain(PAYMENT_ID.toHexString());
    expect(serialized).not.toContain(SHIPMENT_ID.toHexString());
  });

  it('reports an unverified origin and no farm when neither exists yet', async () => {
    farmerProfileModel.findOne.mockReturnValue(query(null));

    const trace = await service.traceProduct(PRODUCT_ID.toHexString());

    expect(trace.farmer).toBeNull();
    expect(trace.events).toEqual([]);
    expect(trace.summary.originVerified).toBe(false);
    // No paid orders means no payment ledger lookup at all.
    expect(blockchainModel.find).toHaveBeenCalledTimes(1);
  });

  describe('Fabric read-back', () => {
    function confirmedListed(txHash: string) {
      return supplyChainRecord('listed', '2026-08-11T11:00:00.000Z', {
        status: BlockchainTxStatus.Confirmed,
        txHash,
      });
    }

    beforeEach(() => fabric.isAvailable.mockReturnValue(true));

    it('marks the origin verified only when the ledger holds the same tx', async () => {
      const listed = confirmedListed('tx-listed');
      blockchainModel.find.mockReturnValueOnce(query([listed]));
      fabric.findByLedgerKey.mockResolvedValue({
        ledgerKey: listed._id.toHexString(),
        referenceId: PRODUCT_ID.toHexString(),
        referenceModel: 'Product',
        txHash: 'tx-listed',
      });

      const trace = await service.traceProduct(PRODUCT_ID.toHexString());

      expect(fabric.findByLedgerKey).toHaveBeenCalledWith(
        listed._id.toHexString(),
      );
      expect(trace.events[0].ledger.onChain).toBe(OnChainCheck.Verified);
      expect(trace.summary.ledgerCheck).toBe(LedgerCheckState.Checked);
      expect(trace.summary.originVerified).toBe(true);
    });

    it('does not call a mismatched or missing ledger record verified', async () => {
      blockchainModel.find.mockReturnValueOnce(
        query([confirmedListed('tx-in-outbox')]),
      );
      fabric.findByLedgerKey.mockResolvedValueOnce({
        ledgerKey: 'k',
        referenceId: 'r',
        referenceModel: 'Product',
        txHash: 'some-other-tx',
      });
      const mismatched = await service.traceProduct(PRODUCT_ID.toHexString());
      expect(mismatched.events[0].ledger.onChain).toBe(OnChainCheck.Mismatch);
      expect(mismatched.summary.originVerified).toBe(false);

      blockchainModel.find.mockReturnValueOnce(
        query([confirmedListed('tx-in-outbox')]),
      );
      fabric.findByLedgerKey.mockResolvedValueOnce(null);
      const missing = await service.traceProduct(PRODUCT_ID.toHexString());
      expect(missing.events[0].ledger.onChain).toBe(OnChainCheck.NotFound);
      expect(missing.summary.originVerified).toBe(false);
    });

    it('degrades to unavailable instead of failing when the peer errors', async () => {
      blockchainModel.find.mockReturnValueOnce(
        query([confirmedListed('tx-listed')]),
      );
      fabric.findByLedgerKey.mockRejectedValue(new Error('14 UNAVAILABLE'));

      const trace = await service.traceProduct(PRODUCT_ID.toHexString());

      expect(trace.summary.ledgerCheck).toBe(LedgerCheckState.Unavailable);
      expect(trace.events[0].ledger.onChain).toBeUndefined();
      expect(trace.events[0].ledger.status).toBe(TraceLedgerStatus.Confirmed);
    });

    it('never re-reads a record it already verified', async () => {
      const listed = confirmedListed('tx-listed');
      fabric.findByLedgerKey.mockResolvedValue({
        ledgerKey: listed._id.toHexString(),
        referenceId: 'r',
        referenceModel: 'Product',
        txHash: 'tx-listed',
      });
      blockchainModel.find.mockReturnValueOnce(query([listed]));
      await service.traceProduct(PRODUCT_ID.toHexString());
      blockchainModel.find.mockReturnValueOnce(query([listed]));
      const again = await service.traceProduct(PRODUCT_ID.toHexString());

      expect(fabric.findByLedgerKey).toHaveBeenCalledTimes(1);
      expect(again.events[0].ledger.onChain).toBe(OnChainCheck.Verified);
    });
  });
});
