import { ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import {
  FarmerProfile,
  FarmerProfileDocument,
  FarmerProfileSchema,
} from '../src/modules/auth/schemas/farmer-profile.schema';
import {
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTransactionSchema,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../src/modules/blockchain/schemas/blockchain-transaction.schema';
import {
  Order,
  OrderDocument,
  OrderSchema,
  OrderStatus,
} from '../src/modules/order/schemas/order.schema';
import {
  Shipment,
  ShipmentDocument,
  ShipmentSchema,
  ShipmentStatus,
} from '../src/modules/transport/schemas/shipment.schema';
import { TransportService } from '../src/modules/transport/transport.service';
import { SystemConfigService } from '../src/modules/admin/services/system-config.service';
import {
  TransporterProfile,
  TransporterProfileDocument,
  TransporterProfileSchema,
  VehicleType,
} from '../src/modules/auth/schemas/transporter-profile.schema';
import { NotificationService } from '../src/modules/notification/notification.service';

// Farm in Faisalabad; "near" is ~5 km away, "far" is Lahore (~120 km).
const FARM = { lat: 31.42, lng: 73.08 };
const NEAR = { lat: 31.44, lng: 73.12 };
const FAR = { lat: 31.52, lng: 74.35 };
const point = ({ lat, lng }: { lat: number; lng: number }) => ({
  type: 'Point' as const,
  coordinates: [lng, lat] as [number, number],
});

describe('TransportService self-claim transaction integration', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let service: TransportService;
  let orderModel: Model<OrderDocument>;
  let farmerProfileModel: Model<FarmerProfileDocument>;
  let shipmentModel: Model<ShipmentDocument>;
  let blockchainModel: Model<BlockchainTransactionDocument>;
  let connection: Connection;
  let transporterModel: Model<TransporterProfileDocument>;
  const notifications = {
    notify: jest.fn(() => Promise.resolve()),
    notifyInBackground: jest.fn(),
  };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(replSet.getUri()),
        MongooseModule.forFeature([
          { name: Order.name, schema: OrderSchema },
          { name: FarmerProfile.name, schema: FarmerProfileSchema },
          { name: TransporterProfile.name, schema: TransporterProfileSchema },
          { name: Shipment.name, schema: ShipmentSchema },
          {
            name: BlockchainTransaction.name,
            schema: BlockchainTransactionSchema,
          },
        ]),
      ],
      providers: [
        TransportService,
        {
          provide: SystemConfigService,
          useValue: {
            getDeliverySettings: () =>
              Promise.resolve(SystemConfigService.defaultDeliverySettings),
          },
        },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();

    service = moduleRef.get(TransportService);
    orderModel = moduleRef.get(getModelToken(Order.name));
    farmerProfileModel = moduleRef.get(getModelToken(FarmerProfile.name));
    shipmentModel = moduleRef.get(getModelToken(Shipment.name));
    blockchainModel = moduleRef.get(getModelToken(BlockchainTransaction.name));
    connection = moduleRef.get(getConnectionToken());
    transporterModel = moduleRef.get(getModelToken(TransporterProfile.name));
    // Build the unique and 2dsphere indexes before querying.
    await Promise.all([
      shipmentModel.init(),
      orderModel.init(),
      transporterModel.init(),
    ]);
  });

  afterAll(async () => {
    await connection.close();
    await moduleRef.close();
    await replSet.stop();
  });

  it('allows exactly one concurrent transporter claim and records one shipment event', async () => {
    const { order } = await createClaimableOrder();
    const transporterA = await onlineTransporter();
    const transporterB = await onlineTransporter();

    const results = await Promise.allSettled([
      service.claim(order.id, transporterA.toHexString()),
      service.claim(order.id, transporterB.toHexString()),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<unknown> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    expect(await shipmentModel.countDocuments({ orderId: order._id })).toBe(1);
    expect(
      await blockchainModel.countDocuments({
        type: BlockchainTxType.SupplyChainEvent,
      }),
    ).toBe(1);
    await expect(orderModel.findById(order.id).exec()).resolves.toMatchObject({
      status: OrderStatus.Processing,
    });
  });

  it('records one pending shipment event per distinct product in a claimed order', async () => {
    const productA = new Types.ObjectId();
    const productB = new Types.ObjectId();
    const { order } = await createClaimableOrder([
      productA,
      productA,
      productB,
    ]);

    await service.claim(order.id, (await onlineTransporter()).toHexString());

    const shipment = await shipmentModel.findOne({ orderId: order._id }).exec();
    expect(shipment).not.toBeNull();
    const events = await blockchainModel
      .find({
        referenceId: shipment!._id,
        type: BlockchainTxType.SupplyChainEvent,
        status: BlockchainTxStatus.Pending,
      })
      .exec();
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.referenceId.toHexString())).toEqual([
      shipment!._id.toHexString(),
      shipment!._id.toHexString(),
    ]);
    expect(
      events
        .map((event) => event.payload.supplyChain?.productId?.toHexString())
        .sort(),
    ).toEqual([productA.toHexString(), productB.toHexString()].sort());
  });

  it('converts a duplicate shipment key error into a delivery conflict', async () => {
    const { order } = await createClaimableOrder();
    const existingTransporter = new Types.ObjectId();
    await shipmentModel.create({
      orderId: order._id,
      transporterId: existingTransporter,
      status: ShipmentStatus.Assigned,
      pickupAddress: {
        street: 'Green Farm',
        city: 'Faisalabad',
        province: 'Punjab',
      },
      deliveryAddress: order.shippingAddress,
      statusHistory: [
        {
          status: ShipmentStatus.Assigned,
          timestamp: new Date(),
          updatedBy: existingTransporter,
        },
      ],
    });

    await expect(
      service.claim(order.id, (await onlineTransporter()).toHexString()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets one transporter hold only one delivery, even when accepting two at once', async () => {
    const [{ order: first }, { order: second }] = await Promise.all([
      createClaimableOrder(),
      createClaimableOrder(),
    ]);
    const transporter = (await onlineTransporter()).toHexString();

    const results = await Promise.allSettled([
      service.claim(first.id, transporter),
      service.claim(second.id, transporter),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await shipmentModel.countDocuments({
        transporterId: new Types.ObjectId(transporter),
      }),
    ).toBe(1);
  });

  it('offers nearby orders nearest first, skips far and declined ones, and pings only free nearby transporters', async () => {
    await orderModel.deleteMany({});
    await shipmentModel.deleteMany({});
    await transporterModel.deleteMany({});
    const { order: near } = await createClaimableOrder();
    const { order: declined } = await createClaimableOrder();
    const { order: farAway } = await createClaimableOrder(undefined, {
      lat: 33.68,
      lng: 73.04,
    });
    const me = await onlineTransporter();
    const busy = await onlineTransporter();
    await onlineTransporter(FAR);
    await onlineTransporter(NEAR, { isAvailable: false });
    await shipmentModel.create({
      orderId: new Types.ObjectId(),
      transporterId: busy,
      status: ShipmentStatus.InTransit,
      statusHistory: [],
    });
    await service.decline(declined.id, me.toHexString());

    const offers = await service.findAvailable(me.toHexString());
    expect(offers.map((o) => o.orderId)).toEqual([near.id]);
    expect(offers.map((o) => o.orderId)).not.toContain(farAway.id);

    notifications.notify.mockClear();
    await expect(service.dispatch(near._id)).resolves.toBe(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: [me] }),
    );
  });

  it('refuses an accept from outside the dispatch radius', async () => {
    const { order } = await createClaimableOrder();
    const far = await onlineTransporter(FAR);
    await expect(service.claim(order.id, far.toHexString())).rejects.toThrow(
      'outside your area',
    );
  });

  async function onlineTransporter(
    at = NEAR,
    overrides: Record<string, unknown> = {},
  ): Promise<Types.ObjectId> {
    const userId = new Types.ObjectId();
    await transporterModel.create({
      userId,
      vehicleType: VehicleType.Van,
      vehicleNumber: 'LEA-1234',
      licenseNumber: `LIC-${userId.toHexString()}`,
      cnic: `CNIC-${userId.toHexString()}`,
      isAvailable: true,
      lastLocation: point(at),
      lastLocationAt: new Date(),
      ...overrides,
    });
    return userId;
  }

  async function createClaimableOrder(
    productIds = [new Types.ObjectId()],
    farm = FARM,
  ): Promise<{ order: OrderDocument }> {
    const buyerId = new Types.ObjectId();
    const farmerId = new Types.ObjectId();
    await farmerProfileModel.create({
      userId: farmerId,
      farmName: `Green Farm ${farmerId.toHexString()}`,
      cnic: `CNIC-${farmerId.toHexString()}`,
      farmLocation: {
        address: 'Green Farm, Canal Road',
        city: 'Faisalabad',
        province: 'Punjab',
        ...farm,
      },
    });
    const order = await orderModel.create({
      pickupLocation: point(farm),
      deliveryFee: 1270,
      deliveryDistanceKm: 44.6,
      buyerId,
      farmerId,
      items: productIds.map((productId, index) => ({
        productId,
        farmerId,
        productName: `Integration product ${index + 1}`,
        quantity: 2,
        unitPrice: 100,
        subtotal: 200,
      })),
      totalAmount: 200,
      platformFeePercent: 5,
      platformFeeAmount: 10,
      grandTotal: 210,
      shippingAddress: {
        street: '21 Market Road',
        city: 'Lahore',
        province: 'Punjab',
        lat: 31.52,
        lng: 74.35,
      },
      status: OrderStatus.Paid,
    });
    return { order };
  }
});
