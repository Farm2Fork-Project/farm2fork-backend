import { ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
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

describe('TransportService self-claim transaction integration', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let service: TransportService;
  let orderModel: Model<OrderDocument>;
  let farmerProfileModel: Model<FarmerProfileDocument>;
  let shipmentModel: Model<ShipmentDocument>;
  let blockchainModel: Model<BlockchainTransactionDocument>;
  let connection: Connection;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(replSet.getUri()),
        MongooseModule.forFeature([
          { name: Order.name, schema: OrderSchema },
          { name: FarmerProfile.name, schema: FarmerProfileSchema },
          { name: Shipment.name, schema: ShipmentSchema },
          {
            name: BlockchainTransaction.name,
            schema: BlockchainTransactionSchema,
          },
        ]),
      ],
      providers: [TransportService],
    }).compile();

    service = moduleRef.get(TransportService);
    orderModel = moduleRef.get(getModelToken(Order.name));
    farmerProfileModel = moduleRef.get(getModelToken(FarmerProfile.name));
    shipmentModel = moduleRef.get(getModelToken(Shipment.name));
    blockchainModel = moduleRef.get(getModelToken(BlockchainTransaction.name));
    connection = moduleRef.get(getConnectionToken());
    await shipmentModel.init();
  });

  afterAll(async () => {
    await connection.close();
    await moduleRef.close();
    await replSet.stop();
  });

  it('allows exactly one concurrent transporter claim and records one shipment event', async () => {
    const { order } = await createClaimableOrder();
    const transporterA = new Types.ObjectId();
    const transporterB = new Types.ObjectId();

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

    await service.claim(order.id, new Types.ObjectId().toHexString());

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
      service.claim(order.id, new Types.ObjectId().toHexString()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  async function createClaimableOrder(
    productIds = [new Types.ObjectId()],
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
      },
    });
    const order = await orderModel.create({
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
      },
      status: OrderStatus.Paid,
    });
    return { order };
  }
});
