import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import {
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTransactionSchema,
} from '../src/modules/blockchain/schemas/blockchain-transaction.schema';
import {
  Product,
  ProductDocument,
  ProductSchema,
  ProductStatus,
  ProductUnit,
} from '../src/modules/marketplace/schemas/product.schema';
import {
  Order,
  OrderDocument,
  OrderSchema,
  OrderStatus,
} from '../src/modules/order/schemas/order.schema';
import { PaymentService } from '../src/modules/payment/payment.service';
import {
  Payment,
  PaymentDocument,
  PaymentGateway,
  PaymentSchema,
  PaymentStatus,
} from '../src/modules/payment/schemas/payment.schema';

describe('PaymentService transaction integration', () => {
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let service: PaymentService;
  let paymentModel: Model<PaymentDocument>;
  let orderModel: Model<OrderDocument>;
  let productModel: Model<ProductDocument>;
  let blockchainModel: Model<BlockchainTransactionDocument>;
  let connection: Connection;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(replSet.getUri()),
        MongooseModule.forFeature([
          { name: Payment.name, schema: PaymentSchema },
          { name: Order.name, schema: OrderSchema },
          { name: Product.name, schema: ProductSchema },
          {
            name: BlockchainTransaction.name,
            schema: BlockchainTransactionSchema,
          },
        ]),
      ],
      providers: [
        PaymentService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'PAYMENT_SIMULATOR_ENABLED') return true;
              if (key === 'NODE_ENV') return 'test';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(PaymentService);
    paymentModel = moduleRef.get(getModelToken(Payment.name));
    orderModel = moduleRef.get(getModelToken(Order.name));
    productModel = moduleRef.get(getModelToken(Product.name));
    blockchainModel = moduleRef.get(getModelToken(BlockchainTransaction.name));
    connection = moduleRef.get(getConnectionToken());
  });

  afterAll(async () => {
    await connection.close();
    await moduleRef.close();
    await replSet.stop();
  });

  it('settles a payment once across payment, order, stock, and blockchain outbox', async () => {
    const buyerId = new Types.ObjectId();
    const farmerId = new Types.ObjectId();
    const product = await productModel.create({
      farmerId,
      name: 'Integration tomatoes',
      category: 'vegetables',
      price: 100,
      quantity: 2,
      unit: ProductUnit.Kg,
      status: ProductStatus.Active,
    });
    const order = await orderModel.create({
      buyerId,
      farmerId,
      items: [
        {
          productId: product._id,
          farmerId,
          productName: product.name,
          quantity: 2,
          unitPrice: 100,
          subtotal: 200,
        },
      ],
      totalAmount: 200,
      platformFeePercent: 5,
      platformFeeAmount: 10,
      grandTotal: 210,
      shippingAddress: { street: '1 Farm Road', city: 'Lahore', province: 'Punjab' },
      status: OrderStatus.Pending,
    });
    const payment = await paymentModel.create({
      orderId: order._id,
      buyerId,
      amount: order.grandTotal,
      currency: 'PKR',
      gateway: PaymentGateway.JazzCash,
      gatewayRef: 'integration-reference',
      status: PaymentStatus.Pending,
    });

    const first = await service.simulate(
      payment.id,
      buyerId.toHexString(),
      PaymentStatus.Success,
    );
    const replay = await service.simulate(
      payment.id,
      buyerId.toHexString(),
      PaymentStatus.Success,
    );

    expect(first.status).toBe(PaymentStatus.Success);
    expect(replay.status).toBe(PaymentStatus.Success);
    await expect(productModel.findById(product.id).exec()).resolves.toMatchObject({
      quantity: 0,
      status: ProductStatus.SoldOut,
    });
    await expect(orderModel.findById(order.id).exec()).resolves.toMatchObject({
      status: OrderStatus.Paid,
      paymentId: payment._id,
    });
    await expect(paymentModel.findById(payment.id).exec()).resolves.toMatchObject({
      status: PaymentStatus.Success,
    });
    expect(await blockchainModel.countDocuments({ referenceId: payment._id })).toBe(1);
  });
});
