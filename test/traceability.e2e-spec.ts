import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
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
  BlockchainReferenceModel,
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTransactionSchema,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../src/modules/blockchain/schemas/blockchain-transaction.schema';
import { MarketplaceService } from '../src/modules/marketplace/marketplace.service';
import {
  Product,
  ProductDocument,
  ProductSchema,
  ProductUnit,
  QualityGrade,
} from '../src/modules/marketplace/schemas/product.schema';
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
} from '../src/modules/transport/schemas/shipment.schema';
import { TraceabilityService } from '../src/modules/traceability/traceability.service';
import { TransportService } from '../src/modules/transport/transport.service';

describe('Product provenance: listing -> payment -> shipment -> public trace', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let marketplace: MarketplaceService;
  let transport: TransportService;
  let traceability: TraceabilityService;
  let productModel: Model<ProductDocument>;
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
          { name: Product.name, schema: ProductSchema },
          { name: Order.name, schema: OrderSchema },
          { name: FarmerProfile.name, schema: FarmerProfileSchema },
          { name: Shipment.name, schema: ShipmentSchema },
          {
            name: BlockchainTransaction.name,
            schema: BlockchainTransactionSchema,
          },
        ]),
      ],
      providers: [
        MarketplaceService,
        TransportService,
        TraceabilityService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'PUBLIC_TRACE_ORIGIN'
                ? 'http://localhost:3001'
                : undefined,
          },
        },
      ],
    }).compile();

    marketplace = moduleRef.get(MarketplaceService);
    transport = moduleRef.get(TransportService);
    traceability = moduleRef.get(TraceabilityService);
    productModel = moduleRef.get(getModelToken(Product.name));
    orderModel = moduleRef.get(getModelToken(Order.name));
    farmerProfileModel = moduleRef.get(getModelToken(FarmerProfile.name));
    shipmentModel = moduleRef.get(getModelToken(Shipment.name));
    blockchainModel = moduleRef.get(getModelToken(BlockchainTransaction.name));
    connection = moduleRef.get(getConnectionToken());
    await Promise.all([
      productModel.init(),
      shipmentModel.init(),
      blockchainModel.init(),
    ]);
  });

  afterAll(async () => {
    await connection.close();
    await moduleRef.close();
    await replSet.stop();
  });

  it('builds a public, ledger-annotated journey from real writes', async () => {
    const farmerId = new Types.ObjectId();
    const buyerId = new Types.ObjectId();
    await farmerProfileModel.create({
      userId: farmerId,
      farmName: 'Green Valley Farm',
      cnic: `CNIC-${farmerId.toHexString()}`,
      farmLocation: {
        address: 'Plot 7, Canal Road',
        city: 'Multan',
        province: 'Punjab',
      },
    });

    // 1. Listing: the product and its `listed` outbox record commit together.
    const created = await marketplace.create(farmerId.toHexString(), {
      name: 'Chaunsa Mangoes',
      category: 'fruits',
      price: 300,
      quantity: 100,
      unit: ProductUnit.Kg,
      qualityGrade: QualityGrade.A,
    });
    expect(created.qrCode).toBe(`http://localhost:3001/trace/${created.id}`);
    expect(created.initialBlockchainRecordId).toEqual(expect.any(String));
    const listed = await blockchainModel
      .findById(created.initialBlockchainRecordId)
      .exec();
    expect(listed).toMatchObject({
      type: BlockchainTxType.SupplyChainEvent,
      referenceModel: BlockchainReferenceModel.Product,
      status: BlockchainTxStatus.Pending,
    });
    expect(listed!.payload.supplyChain).toMatchObject({
      eventType: 'listed',
      location: 'Multan, Punjab',
      actorRole: 'farmer',
    });

    let trace = await traceability.traceProduct(created.id);
    expect(trace.summary).toEqual({
      totalEvents: 1,
      confirmedEvents: 0,
      originVerified: false,
    });

    // 2. The Fabric worker confirms the listing on the ledger.
    await blockchainModel.updateOne(
      { _id: listed!._id },
      {
        $set: {
          status: BlockchainTxStatus.Confirmed,
          txHash: 'fabric-tx-listed-e2e',
          blockNumber: 11,
          channelName: 'farm2forkchannel',
          confirmedAt: new Date(),
        },
      },
    );

    // 3. A paid order containing the product, with its payment ledger record.
    const paymentId = new Types.ObjectId();
    const order = await orderModel.create({
      buyerId,
      farmerId,
      items: [
        {
          productId: new Types.ObjectId(created.id),
          farmerId,
          productName: 'Chaunsa Mangoes',
          quantity: 10,
          unitPrice: 300,
          subtotal: 3000,
        },
      ],
      totalAmount: 3000,
      platformFeePercent: 5,
      platformFeeAmount: 150,
      grandTotal: 3150,
      shippingAddress: {
        street: '21 Market Road',
        city: 'Lahore',
        province: 'Punjab',
      },
      status: OrderStatus.Paid,
      paymentId,
    });
    await blockchainModel.create({
      type: BlockchainTxType.Payment,
      referenceId: paymentId,
      referenceModel: BlockchainReferenceModel.Payment,
      payload: {
        payment: {
          orderId: order._id,
          buyerId,
          farmerId,
          amount: 3150,
          currency: 'PKR',
          gateway: 'stripe',
          paidAt: new Date(),
        },
        supplyChain: null,
      },
      status: BlockchainTxStatus.Pending,
    });

    // 4. A transporter claims the delivery (real transactional path).
    await transport.claim(order.id, new Types.ObjectId().toHexString());

    trace = await traceability.traceProduct(created.id);
    expect(trace.farmer).toEqual({
      farmName: 'Green Valley Farm',
      city: 'Multan',
      province: 'Punjab',
    });
    expect(trace.events.map((event) => event.type)).toEqual([
      'listed',
      'payment_confirmed',
      'shipment_assigned',
    ]);
    expect(trace.events[0].ledger).toMatchObject({
      status: 'confirmed',
      txHash: 'fabric-tx-listed-e2e',
      blockNumber: 11,
    });
    expect(trace.summary).toEqual({
      totalEvents: 3,
      confirmedEvents: 1,
      originVerified: true,
    });

    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain('3150');
    expect(serialized).not.toContain('Canal Road');
    expect(serialized).not.toContain('21 Market Road');
    expect(serialized).not.toContain(buyerId.toHexString());
    expect(serialized).not.toContain('stripe');
  });

  it('rolls the listing back if its provenance record cannot be written', async () => {
    const farmerId = new Types.ObjectId();
    const before = await productModel.countDocuments();
    const spy = jest
      .spyOn(blockchainModel, 'create')
      .mockRejectedValueOnce(new Error('outbox unavailable'));

    await expect(
      marketplace.create(farmerId.toHexString(), {
        name: 'Wheat',
        category: 'grains',
        price: 90,
        quantity: 1000,
        unit: ProductUnit.Kg,
      }),
    ).rejects.toThrow('outbox unavailable');

    spy.mockRestore();
    expect(await productModel.countDocuments()).toBe(before);
  });
});
