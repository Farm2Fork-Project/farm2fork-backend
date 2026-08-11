import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import {
  BlockchainReferenceModel,
  BlockchainTransaction,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../blockchain/schemas/blockchain-transaction.schema';
import { FarmerProfile } from '../auth/schemas/farmer-profile.schema';
import { Order, OrderStatus } from '../order/schemas/order.schema';
import { Shipment, ShipmentStatus } from './schemas/shipment.schema';
import { TransportService } from './transport.service';

const query = <T>(value: T) => ({
  exec: jest.fn<() => Promise<T>>().mockResolvedValue(value),
});

const transactionQuery = <T>(value: T) => ({
  session: jest.fn().mockReturnThis(),
  exec: jest.fn<() => Promise<T>>().mockResolvedValue(value),
});

const orderId = '66a2fe77bb77795516febc50';
const farmerId = '66a2fe77bb77795516febc51';
const transporterId = '66a2fe77bb77795516febc52';

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(orderId),
  id: orderId,
  farmerId: new Types.ObjectId(farmerId),
  status: OrderStatus.Paid,
  items: [{ productName: 'Tomatoes' }, { productName: 'Okra' }],
  shippingAddress: {
    street: '21 Market Road',
    city: 'Lahore',
    province: 'Punjab',
    zip: '54000',
  },
  createdAt: new Date('2026-08-11T00:00:00.000Z'),
  save: jest.fn(),
  ...overrides,
});

const makeFarmProfile = (overrides: Record<string, unknown> = {}) => ({
  userId: new Types.ObjectId(farmerId),
  farmLocation: {
    address: 'Green Farm, Canal Road',
    city: 'Faisalabad',
    province: 'Punjab',
  },
  ...overrides,
});

describe('TransportService', () => {
  let service: TransportService;
  let orderModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  let farmerProfileModel: { find: jest.Mock; findOne: jest.Mock };
  let shipmentModel: { create: jest.Mock };
  let blockchainModel: { create: jest.Mock };
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };

  beforeEach(async () => {
    orderModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    farmerProfileModel = { find: jest.fn(), findOne: jest.fn() };
    shipmentModel = { create: jest.fn() };
    blockchainModel = { create: jest.fn() };
    session = {
      withTransaction: jest.fn(async (callback: () => Promise<unknown>) =>
        callback(),
      ),
      endSession: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TransportService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(FarmerProfile.name), useValue: farmerProfileModel },
        { provide: getModelToken(Shipment.name), useValue: shipmentModel },
        {
          provide: getModelToken(BlockchainTransaction.name),
          useValue: blockchainModel,
        },
        { provide: getConnectionToken(), useValue: { startSession: jest.fn().mockResolvedValue(session) } },
      ],
    }).compile();

    service = moduleRef.get(TransportService);
  });

  it('returns only paid unclaimed orders with a complete farm location', async () => {
    const claimableOrder = makeOrder();
    const missingLocationOrder = makeOrder({
      _id: new Types.ObjectId(),
      id: '66a2fe77bb77795516febc54',
      farmerId: new Types.ObjectId(),
    });
    orderModel.find.mockReturnValue(query([claimableOrder, missingLocationOrder]));
    farmerProfileModel.find.mockReturnValue(query([makeFarmProfile()]));

    await expect(service.findAvailable()).resolves.toEqual([
      {
        orderId,
        pickupCity: 'Faisalabad',
        pickupProvince: 'Punjab',
        deliveryCity: 'Lahore',
        deliveryProvince: 'Punjab',
        itemCount: 2,
        createdAt: '2026-08-11T00:00:00.000Z',
      },
    ]);
  });

  it('claims a paid order by creating one assigned shipment and supply-chain outbox event', async () => {
    const order = makeOrder();
    const shipment = {
      _id: new Types.ObjectId(),
      id: 'shipment-1',
      orderId: order._id,
      transporterId: new Types.ObjectId(transporterId),
      status: ShipmentStatus.Assigned,
      pickupAddress: {
        street: 'Green Farm, Canal Road',
        city: 'Faisalabad',
        province: 'Punjab',
      },
      deliveryAddress: order.shippingAddress,
      statusHistory: [
        {
          status: ShipmentStatus.Assigned,
          timestamp: new Date('2026-08-11T00:00:00.000Z'),
          updatedBy: new Types.ObjectId(transporterId),
        },
      ],
      estimatedDelivery: new Date('2026-08-13T00:00:00.000Z'),
      createdAt: new Date('2026-08-11T00:00:00.000Z'),
      updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    };
    order.save.mockResolvedValue(order);
    orderModel.findOne.mockReturnValue(transactionQuery(order));
    farmerProfileModel.findOne.mockReturnValue(transactionQuery(makeFarmProfile()));
    orderModel.findOneAndUpdate.mockReturnValue(transactionQuery(order));
    shipmentModel.create.mockResolvedValue([shipment]);
    blockchainModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

    await expect(service.claim(orderId, transporterId)).resolves.toEqual(
      expect.objectContaining({
        id: 'shipment-1',
        orderId,
        transporterId,
        status: ShipmentStatus.Assigned,
      }),
    );
    expect(shipmentModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          orderId: order._id,
          transporterId: new Types.ObjectId(transporterId),
          status: ShipmentStatus.Assigned,
          statusHistory: [
            expect.objectContaining({
              status: ShipmentStatus.Assigned,
              updatedBy: new Types.ObjectId(transporterId),
            }),
          ],
        }),
      ],
      { session },
    );
    expect(blockchainModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: BlockchainTxType.SupplyChainEvent,
          referenceModel: BlockchainReferenceModel.Shipment,
          status: BlockchainTxStatus.Pending,
          payload: expect.objectContaining({
            supplyChain: expect.objectContaining({
              eventType: 'shipment_assigned',
              actorId: new Types.ObjectId(transporterId),
            }),
          }),
        }),
      ],
      { session },
    );
  });
});
