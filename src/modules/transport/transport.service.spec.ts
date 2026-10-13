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
import {
  DeliverySettings,
  SystemConfigService,
} from '../admin/services/system-config.service';
import { FarmerProfile } from '../auth/schemas/farmer-profile.schema';
import { TransporterProfile } from '../auth/schemas/transporter-profile.schema';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
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

/** Any Mongoose query chain (select/lean/limit/...) resolving to value. */
const chain = <T>(value: T) => {
  const q: Record<string, unknown> = {
    exec: jest.fn<() => Promise<T>>().mockResolvedValue(value),
  };
  for (const method of ['select', 'lean', 'limit', 'sort', 'session']) {
    q[method] = jest.fn(() => q);
  }
  return q;
};

type GeoFilter = Record<
  string,
  { $nearSphere: { $geometry: unknown; $maxDistance: number } }
>;

// Farm pin in Faisalabad; the transporter is ~5 km away.
const FARM_PIN = { type: 'Point', coordinates: [73.08, 31.42] };
const NEAR_TRANSPORTER = { type: 'Point', coordinates: [73.12, 31.44] };
const FAR_TRANSPORTER = { type: 'Point', coordinates: [74.35, 31.52] };

const makeTransporter = (overrides: Record<string, unknown> = {}) => ({
  userId: new Types.ObjectId(transporterId),
  isAvailable: true,
  lastLocation: NEAR_TRANSPORTER,
  lastLocationAt: new Date(),
  ...overrides,
});

const orderId = '66a2fe77bb77795516febc50';
const farmerId = '66a2fe77bb77795516febc51';
const transporterId = '66a2fe77bb77795516febc52';
const otherTransporterId = '66a2fe77bb77795516febc53';
const buyerId = '66a2fe77bb77795516febc55';
const productAId = '66a2fe77bb77795516febc56';
const productBId = '66a2fe77bb77795516febc57';

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(orderId),
  id: orderId,
  buyerId: new Types.ObjectId(buyerId),
  farmerId: new Types.ObjectId(farmerId),
  status: OrderStatus.Paid,
  items: [
    { productId: new Types.ObjectId(productAId), productName: 'Tomatoes' },
    { productId: new Types.ObjectId(productAId), productName: 'Tomatoes' },
  ],
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
    findOne: jest.Mock;
    exists: jest.Mock;
    distinct: jest.Mock;
  };
  let blockchainModel: { create: jest.Mock };
  let transporterProfileModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
  };
  let notifications: { notify: jest.Mock; notifyInBackground: jest.Mock };
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };

  beforeEach(async () => {
    orderModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findById: jest.fn(),
    };
    farmerProfileModel = { find: jest.fn(), findOne: jest.fn() };
    shipmentModel = {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(() => chain(null)),
      exists: jest.fn(() => transactionQuery(null)),
      distinct: jest.fn(() => chain([])),
    };
    transporterProfileModel = {
      find: jest.fn(),
      findOne: jest.fn(() => chain(makeTransporter())),
      findOneAndUpdate: jest.fn(() => transactionQuery(makeTransporter())),
      updateOne: jest.fn(() => chain({ matchedCount: 1 })),
    };
    notifications = {
      notify: jest.fn(() => Promise.resolve()),
      notifyInBackground: jest.fn(),
    };
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
        {
          provide: getModelToken(TransporterProfile.name),
          useValue: transporterProfileModel,
        },
        {
          provide: SystemConfigService,
          useValue: {
            getDeliverySettings: jest
              .fn<() => Promise<DeliverySettings>>()
              .mockResolvedValue(SystemConfigService.defaultDeliverySettings),
          },
        },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();

    service = moduleRef.get(TransportService);
  });

  describe('delivery offers', () => {
    it('lists nearby paid orders with the fixed fee and an approximate drop-off', async () => {
      const order = makeOrder({
        pickupLocation: FARM_PIN,
        deliveryFee: 1270,
        deliveryDistanceKm: 44.6,
        shippingAddress: {
          street: '21 Market Road',
          city: 'Lahore',
          province: 'Punjab',
          lat: 31.520412,
          lng: 74.358719,
        },
      });
      orderModel.find.mockReturnValue(chain([order]));
      farmerProfileModel.find.mockReturnValue(
        chain([makeFarmProfile({ farmName: 'Green Farm' })]),
      );

      const [offer] = await service.findAvailable(transporterId);

      expect(offer).toEqual(
        expect.objectContaining({
          orderId,
          deliveryFee: 1270,
          deliveryDistanceKm: 44.6,
          farmName: 'Green Farm',
          pickup: {
            lat: 31.42,
            lng: 73.08,
            city: 'Faisalabad',
            province: 'Punjab',
          },
          dropoffArea: {
            lat: 31.52,
            lng: 74.36,
            city: 'Lahore',
            province: 'Punjab',
          },
        }),
      );
      expect(offer.distanceToPickupKm).toBeGreaterThan(3);
      expect(offer.distanceToPickupKm).toBeLessThan(6);
      expect(JSON.stringify(offer)).not.toContain('21 Market Road');
      const filter = orderModel.find.mock.calls[0][0] as GeoFilter;
      expect(filter.declinedBy).toEqual({
        $ne: new Types.ObjectId(transporterId),
      });
      expect(filter.pickupLocation.$nearSphere.$maxDistance).toBe(25_000);
    });

    it.each([
      ['offline', { isAvailable: false }],
      [
        'with a stale location',
        { lastLocationAt: new Date(Date.now() - 2 * 60 * 60_000) },
      ],
    ])('offers nothing while %s', async (_label, overrides) => {
      transporterProfileModel.findOne.mockReturnValue(
        chain(makeTransporter(overrides)),
      );
      await expect(service.findAvailable(transporterId)).resolves.toEqual([]);
      expect(orderModel.find).not.toHaveBeenCalled();
    });

    it('offers nothing during a delivery in progress', async () => {
      shipmentModel.findOne.mockReturnValue(
        chain({ _id: new Types.ObjectId() }),
      );
      await expect(service.findAvailable(transporterId)).resolves.toEqual([]);
    });

    it('records a decline so the offer is hidden for that transporter', async () => {
      const updateOne = jest.fn(() => chain({ matchedCount: 1 }));
      (orderModel as Record<string, jest.Mock>).updateOne = updateOne;
      await service.decline(orderId, transporterId);
      expect(updateOne).toHaveBeenCalledWith(
        { _id: new Types.ObjectId(orderId), status: OrderStatus.Paid },
        { $addToSet: { declinedBy: new Types.ObjectId(transporterId) } },
      );
    });

    it('pings nearby available transporters except busy ones', async () => {
      const busyId = new Types.ObjectId();
      const freeId = new Types.ObjectId();
      orderModel.findById.mockReturnValue(
        query(
          makeOrder({
            pickupLocation: FARM_PIN,
            deliveryFee: 1270,
            deliveryDistanceKm: 44.6,
            declinedBy: [],
          }),
        ),
      );
      transporterProfileModel.find.mockReturnValue(
        chain([{ userId: busyId }, { userId: freeId }]),
      );
      shipmentModel.distinct.mockReturnValue(chain([busyId]));
      farmerProfileModel.findOne.mockReturnValue(chain(makeFarmProfile()));

      await expect(service.dispatch(orderId)).resolves.toBe(1);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userIds: [freeId],
          type: NotificationType.DeliveryOffer,
          title: 'New delivery · Rs 1,270',
        }),
      );
      const filter = transporterProfileModel.find.mock.calls[0][0] as GeoFilter;
      expect(filter.isAvailable).toBe(true);
      expect(filter.lastLocation.$nearSphere.$geometry).toEqual(FARM_PIN);
    });

    it('does not dispatch an order that is already claimed', async () => {
      orderModel.findById.mockReturnValue(
        query(
          makeOrder({
            pickupLocation: FARM_PIN,
            shipmentId: new Types.ObjectId(),
          }),
        ),
      );
      await expect(service.dispatch(orderId)).resolves.toBe(0);
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('accepting an offer', () => {
    it('refuses while another delivery is in progress', async () => {
      shipmentModel.exists.mockReturnValue(
        transactionQuery({ _id: new Types.ObjectId() }),
      );
      await expect(service.claim(orderId, transporterId)).rejects.toThrow(
        'Finish your current delivery',
      );
      expect(shipmentModel.create).not.toHaveBeenCalled();
    });

    it('refuses an order outside the dispatch radius', async () => {
      transporterProfileModel.findOneAndUpdate.mockReturnValue(
        transactionQuery(makeTransporter({ lastLocation: FAR_TRANSPORTER })),
      );
      orderModel.findOne.mockReturnValue(
        transactionQuery(makeOrder({ pickupLocation: FARM_PIN })),
      );
      await expect(service.claim(orderId, transporterId)).rejects.toThrow(
        'outside your area',
      );
    });

    it('snapshots the fee and both pins onto the shipment and notifies everyone', async () => {
      const order = makeOrder({
        pickupLocation: FARM_PIN,
        deliveryFee: 1270,
        shippingAddress: {
          street: '21 Market Road',
          city: 'Lahore',
          province: 'Punjab',
          lat: 31.52,
          lng: 74.35,
        },
      });
      order.save.mockResolvedValue(order);
      orderModel.findOne.mockReturnValue(transactionQuery(order));
      orderModel.findOneAndUpdate.mockReturnValue(transactionQuery(order));
      farmerProfileModel.findOne.mockReturnValue(
        transactionQuery(makeFarmProfile()),
      );
      shipmentModel.create.mockResolvedValue([makeShipment()]);
      blockchainModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.claim(orderId, transporterId);

      expect(shipmentModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            deliveryFee: 1270,
            pickupAddress: expect.objectContaining({ lat: 31.42, lng: 73.08 }),
            deliveryAddress: expect.objectContaining({
              lat: 31.52,
              lng: 74.35,
            }),
          }),
        ],
        { session },
      );
      const notified = notifications.notifyInBackground.mock.calls.map(
        ([input]) => (input as { userIds: unknown[] }).userIds.map(String),
      );
      expect(notified).toEqual([[buyerId, farmerId], [transporterId]]);
    });
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
      { session, ordered: true },
    );
  });

  it('records one assigned shipment event for each distinct ordered product', async () => {
    const order = makeOrder({
      items: [
        { productId: new Types.ObjectId(productAId), productName: 'Tomatoes' },
        { productId: new Types.ObjectId(productAId), productName: 'Tomatoes' },
        { productId: new Types.ObjectId(productBId), productName: 'Okra' },
      ],
    });
    const shipment = makeShipment({ orderId: order._id });
    order.save.mockResolvedValue(order);
    orderModel.findOne.mockReturnValue(transactionQuery(order));
    farmerProfileModel.findOne.mockReturnValue(
      transactionQuery(makeFarmProfile()),
    );
    orderModel.findOneAndUpdate.mockReturnValue(transactionQuery(order));
    shipmentModel.create.mockResolvedValue([shipment]);
    blockchainModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

    await service.claim(orderId, transporterId);

    expect(blockchainModel.create).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          referenceId: shipment._id,
          payload: expect.objectContaining({
            supplyChain: expect.objectContaining({
              productId: new Types.ObjectId(productAId),
              eventType: 'shipment_assigned',
            }),
          }),
        }),
        expect.objectContaining({
          referenceId: shipment._id,
          payload: expect.objectContaining({
            supplyChain: expect.objectContaining({
              productId: new Types.ObjectId(productBId),
              eventType: 'shipment_assigned',
            }),
          }),
        }),
      ]),
      { session, ordered: true },
    );
    expect(blockchainModel.create.mock.calls[0][0]).toHaveLength(2);
  });

  it('returns only shipments belonging to the requesting buyer orders', async () => {
    const order = makeOrder();
    const shipment = makeShipment();
    orderModel.find.mockReturnValue(query([order]));
    shipmentModel.find.mockReturnValue(chain([shipment]));

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
      { session, ordered: true },
    );
  });

  it('records one status-transition event for each distinct ordered product', async () => {
    const shipment = makeShipment();
    const order = makeOrder({
      status: OrderStatus.Processing,
      items: [
        { productId: new Types.ObjectId(productAId), productName: 'Tomatoes' },
        { productId: new Types.ObjectId(productAId), productName: 'Tomatoes' },
        { productId: new Types.ObjectId(productBId), productName: 'Okra' },
      ],
    });
    shipment.save.mockResolvedValue(shipment);
    order.save.mockResolvedValue(order);
    shipmentModel.findById.mockReturnValue(transactionQuery(shipment));
    orderModel.findById.mockReturnValue(transactionQuery(order));
    blockchainModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

    await service.updateStatus('66a2fe77bb77795516febc56', transporterId, {
      status: ShipmentStatus.PickedUp,
      note: 'Collected produce',
    });

    const records = blockchainModel.create.mock.calls[0][0];
    expect(records).toHaveLength(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            supplyChain: expect.objectContaining({
              productId: new Types.ObjectId(productAId),
              eventType: 'shipment_picked_up',
            }),
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            supplyChain: expect.objectContaining({
              productId: new Types.ObjectId(productBId),
              eventType: 'shipment_picked_up',
            }),
          }),
        }),
      ]),
    );
    expect(records[0].payload.supplyChain.timestamp).toBe(
      records[1].payload.supplyChain.timestamp,
    );
  });
});
