import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
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
const otherTransporterId = '66a2fe77bb77795516febc53';
const buyerId = '66a2fe77bb77795516febc55';

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(orderId),
  id: orderId,
  buyerId: new Types.ObjectId(buyerId),
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

const makeShipment = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  id: 'shipment-1',
  orderId: new Types.ObjectId(orderId),
  transporterId: new Types.ObjectId(transporterId),
  status: ShipmentStatus.Assigned,
  pickupAddress: {
    street: 'Green Farm, Canal Road',
    city: 'Faisalabad',
    province: 'Punjab',
  },
  deliveryAddress: {
    street: '21 Market Road',
    city: 'Lahore',
    province: 'Punjab',
    zip: '54000',
  },
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
  save: jest.fn(),
  ...overrides,
});

describe('TransportService', () => {
  let service: TransportService;
  let orderModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findById: jest.Mock;
  };
  let farmerProfileModel: { find: jest.Mock; findOne: jest.Mock };
  let shipmentModel: {
    create: jest.Mock;
    find: jest.Mock;
    findById: jest.Mock;
  };
  let blockchainModel: { create: jest.Mock };
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };

  beforeEach(async () => {
    orderModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
    };
    farmerProfileModel = { find: jest.fn(), findOne: jest.fn() };
    shipmentModel = { create: jest.fn(), find: jest.fn(), findById: jest.fn() };
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
        {
          provide: getModelToken(FarmerProfile.name),
          useValue: farmerProfileModel,
        },
        { provide: getModelToken(Shipment.name), useValue: shipmentModel },
        {
          provide: getModelToken(BlockchainTransaction.name),
          useValue: blockchainModel,
        },
        {
          provide: getConnectionToken(),
          useValue: { startSession: jest.fn().mockResolvedValue(session) },
        },
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
    orderModel.find.mockReturnValue(
      query([claimableOrder, missingLocationOrder]),
    );
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
    farmerProfileModel.findOne.mockReturnValue(
      transactionQuery(makeFarmProfile()),
    );
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

  it('returns only shipments belonging to the requesting buyer orders', async () => {
    const order = makeOrder();
    const shipment = makeShipment();
    orderModel.find.mockReturnValue(query([order]));
    shipmentModel.find.mockReturnValue(query([shipment]));

    await expect(
      service.findAll({
        id: buyerId,
        role: UserRole.Buyer,
        email: 'buyer@example.com',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'shipment-1',
        orderId,
        transporterId,
      }),
    ]);
    expect(orderModel.find).toHaveBeenCalledWith({
      buyerId: new Types.ObjectId(buyerId),
    });
  });

  it('rejects a delivery status update from a transporter that does not own the shipment', async () => {
    shipmentModel.findById.mockReturnValue(transactionQuery(makeShipment()));

    await expect(
      service.updateStatus('66a2fe77bb77795516febc56', otherTransporterId, {
        status: ShipmentStatus.PickedUp,
        note: 'Collected produce',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a status transition that skips the next delivery state', async () => {
    shipmentModel.findById.mockReturnValue(transactionQuery(makeShipment()));

    await expect(
      service.updateStatus('66a2fe77bb77795516febc56', transporterId, {
        status: ShipmentStatus.Delivered,
        note: 'Skipped states',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('records the accepted status transition, order status, and supply-chain event', async () => {
    const shipment = makeShipment();
    const order = makeOrder({ status: OrderStatus.Processing });
    shipment.save.mockResolvedValue(shipment);
    order.save.mockResolvedValue(order);
    shipmentModel.findById.mockReturnValue(transactionQuery(shipment));
    orderModel.findById.mockReturnValue(transactionQuery(order));
    blockchainModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

    await expect(
      service.updateStatus('66a2fe77bb77795516febc56', transporterId, {
        status: ShipmentStatus.PickedUp,
        note: 'Collected produce',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ status: ShipmentStatus.PickedUp }),
    );
    expect(shipment.statusHistory).toEqual([
      expect.objectContaining({ status: ShipmentStatus.Assigned }),
      expect.objectContaining({
        status: ShipmentStatus.PickedUp,
        note: 'Collected produce',
        updatedBy: new Types.ObjectId(transporterId),
      }),
    ]);
    expect(order.status).toBe(OrderStatus.Shipped);
    expect(blockchainModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: BlockchainTxType.SupplyChainEvent,
          referenceModel: BlockchainReferenceModel.Shipment,
          payload: expect.objectContaining({
            supplyChain: expect.objectContaining({
              eventType: 'shipment_picked_up',
              actorId: new Types.ObjectId(transporterId),
            }),
          }),
        }),
      ],
      { session },
    );
  });
});
