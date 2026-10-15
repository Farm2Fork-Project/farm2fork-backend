import { User, UserSchema } from '../src/modules/auth/schemas/user.schema';
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
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import { PaymentController } from '../src/modules/payment/payment.controller';
import { SafepayClient } from '../src/modules/payment/safepay/safepay.client';
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
import { NotificationService } from '../src/modules/notification/notification.service';
import { TransportService } from '../src/modules/transport/transport.service';
import {
  Payment,
  PaymentDocument,
  PaymentGateway,
  PaymentSchema,
  PaymentStatus,
} from '../src/modules/payment/schemas/payment.schema';

describe('PaymentService transaction integration', () => {
  const transport = { dispatchInBackground: jest.fn() };
  let replSet: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let service: PaymentService;
  let paymentModel: Model<PaymentDocument>;
  let orderModel: Model<OrderDocument>;
  let productModel: Model<ProductDocument>;
  let blockchainModel: Model<BlockchainTransactionDocument>;
  let app: INestApplication;
  const webhookSecret = 'integration-only-webhook-secret';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(replSet.getUri()),
        MongooseModule.forFeature([
          { name: Payment.name, schema: PaymentSchema },
          { name: User.name, schema: UserSchema },
          { name: Order.name, schema: OrderSchema },
          { name: Product.name, schema: ProductSchema },
          {
            name: BlockchainTransaction.name,
            schema: BlockchainTransactionSchema,
          },
        ]),
      ],
      controllers: [PaymentController],
      providers: [
        PaymentService,
        SafepayClient,
        {
          provide: NotificationService,
          useValue: { notifyInBackground: jest.fn() },
        },
        { provide: TransportService, useValue: transport },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            PAYMENT_SIMULATOR_ENABLED: true,
            NODE_ENV: 'test',
            safepay: { webhookSecret },
          }),
        },
      ],
    }).compile();

    service = moduleRef.get(PaymentService);
    paymentModel = moduleRef.get(getModelToken(Payment.name));
    orderModel = moduleRef.get(getModelToken(Order.name));
    productModel = moduleRef.get(getModelToken(Product.name));
    blockchainModel = moduleRef.get(getModelToken(BlockchainTransaction.name));
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    else if (moduleRef) await moduleRef.close();
    if (replSet) await replSet.stop();
  });

  beforeEach(async () => {
    transport.dispatchInBackground.mockClear();
    await Promise.all([
      paymentModel.deleteMany({}),
      orderModel.deleteMany({}),
      productModel.deleteMany({}),
      blockchainModel.deleteMany({}),
    ]);
  });

  function signedWebhook(type: string, data: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/payments/webhook/safepay')
      .set(
        'x-sfpy-signature',
        createHmac('sha512', webhookSecret)
          .update(JSON.stringify(data))
          .digest('hex'),
      )
      .send({ type, data });
  }

  async function seedSafepay() {
    const buyerId = new Types.ObjectId();
    const farmerId = new Types.ObjectId();
    const product = await productModel.create({
      farmerId,
      name: 'Webhook tomatoes',
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
      shippingAddress: {
        street: '1 Farm Road',
        city: 'Lahore',
        province: 'Punjab',
      },
      status: OrderStatus.Pending,
    });
    const payment = await paymentModel.create({
      orderId: order._id,
      buyerId,
      amount: 210,
      currency: 'PKR',
      gateway: PaymentGateway.Safepay,
      gatewayRef: 'tracker-integration',
      status: PaymentStatus.Pending,
    });
    return { product, order, payment };
  }

  async function expectUnsettled(
    fixture: Awaited<ReturnType<typeof seedSafepay>>,
  ) {
    await expect(
      productModel.findById(fixture.product.id).exec(),
    ).resolves.toMatchObject({
      quantity: 2,
      status: ProductStatus.Active,
    });
    await expect(
      orderModel.findById(fixture.order.id).exec(),
    ).resolves.toMatchObject({
      status: OrderStatus.Pending,
    });
    expect(await blockchainModel.countDocuments()).toBe(0);
  }

  it('settles concurrent signed callbacks once and persists the Safepay outbox payload', async () => {
    const fixture = await seedSafepay();
    const data = { tracker: { token: fixture.payment.gatewayRef } };
    const responses = await Promise.all([
      signedWebhook('payment.succeeded', data),
      signedWebhook('payment.succeeded', data),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        received: true,
        gateway: 'safepay',
        status: 'success',
      });
    }
    await signedWebhook('payment.succeeded', data).expect(201);
    await expect(
      productModel.findById(fixture.product.id).exec(),
    ).resolves.toMatchObject({
      quantity: 0,
      status: ProductStatus.SoldOut,
    });
    await expect(
      orderModel.findById(fixture.order.id).exec(),
    ).resolves.toMatchObject({
      status: OrderStatus.Paid,
      paymentId: fixture.payment._id,
    });
    const payment = await paymentModel
      .findById(fixture.payment.id)
      .orFail()
      .exec();
    expect(payment.status).toBe(PaymentStatus.Success);
    expect(payment.paidAt).toBeInstanceOf(Date);
    const records = await blockchainModel
      .find({ referenceId: payment._id })
      .exec();
    expect(records).toHaveLength(1);
    expect(payment.blockchainTxId).toEqual(records[0]._id);
    expect(records[0]).toMatchObject({
      status: 'pending',
      payload: {
        payment: {
          gateway: 'safepay',
          orderId: fixture.order._id,
          buyerId: fixture.order.buyerId,
          farmerId: fixture.order.farmerId,
          amount: 210,
          currency: 'PKR',
        },
      },
    });
  });

  it.each(['missing', 'invalid', 'tampered'])(
    'rejects a %s signature without persistence changes',
    async (kind) => {
      const fixture = await seedSafepay();
      const data = { token: fixture.payment.gatewayRef };
      const callback = request(app.getHttpServer()).post(
        '/payments/webhook/safepay',
      );
      if (kind !== 'missing') {
        callback.set(
          'x-sfpy-signature',
          kind === 'invalid'
            ? 'invalid'
            : createHmac('sha512', webhookSecret)
                .update(JSON.stringify({ token: 'different' }))
                .digest('hex'),
        );
      }
      await callback.send({ type: 'payment.succeeded', data }).expect(403);
      await expectUnsettled(fixture);
      await expect(
        paymentModel.findById(fixture.payment.id).exec(),
      ).resolves.toMatchObject({ status: PaymentStatus.Pending });
    },
  );

  it('acknowledges authorization events without marking the order paid', async () => {
    const fixture = await seedSafepay();
    const response = await signedWebhook('authorization.succeeded', {
      token: fixture.payment.gatewayRef,
    }).expect(201);
    expect(response.body.status).toBe('ignored');
    await expectUnsettled(fixture);
    await expect(
      paymentModel.findById(fixture.payment.id).exec(),
    ).resolves.toMatchObject({ status: PaymentStatus.Pending });
  });

  it('records a failed payment without consuming stock or emitting a ledger record', async () => {
    const fixture = await seedSafepay();
    const response = await signedWebhook('payment.failed', {
      token: fixture.payment.gatewayRef,
    }).expect(201);
    expect(response.body.status).toBe('failed');
    await expectUnsettled(fixture);
    await expect(
      paymentModel.findById(fixture.payment.id).exec(),
    ).resolves.toMatchObject({
      status: PaymentStatus.Failed,
      failedAt: expect.any(Date),
    });
  });

  it('rolls back earlier stock decrements when a later item has insufficient stock', async () => {
    const fixture = await seedSafepay();
    const unavailable = await productModel.create({
      farmerId: fixture.order.farmerId,
      name: 'Unavailable carrots',
      category: 'vegetables',
      price: 100,
      quantity: 1,
      unit: ProductUnit.Kg,
      status: ProductStatus.Active,
    });
    fixture.order.items.push({
      productId: unavailable._id,
      farmerId: fixture.order.farmerId,
      productName: unavailable.name,
      quantity: 2,
      unitPrice: 100,
      subtotal: 200,
    });
    fixture.order.totalAmount = 400;
    fixture.order.platformFeeAmount = 20;
    fixture.order.grandTotal = 420;
    await fixture.order.save();
    await paymentModel.updateOne({ _id: fixture.payment._id }, { amount: 420 });
    await signedWebhook('payment.succeeded', {
      token: fixture.payment.gatewayRef,
    }).expect(400);
    await expectUnsettled(fixture);
    await expect(
      productModel.findById(unavailable.id).exec(),
    ).resolves.toMatchObject({ quantity: 1 });
    await expect(
      paymentModel.findById(fixture.payment.id).exec(),
    ).resolves.toMatchObject({ status: PaymentStatus.Pending });
  });

  it('rejects an unknown tracker without changing an existing payment', async () => {
    const fixture = await seedSafepay();
    await signedWebhook('payment.succeeded', {
      token: 'unknown-tracker',
    }).expect(404);
    await expectUnsettled(fixture);
    await expect(
      paymentModel.findById(fixture.payment.id).exec(),
    ).resolves.toMatchObject({ status: PaymentStatus.Pending });
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
      shippingAddress: {
        street: '1 Farm Road',
        city: 'Lahore',
        province: 'Punjab',
      },
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
    await expect(
      productModel.findById(product.id).exec(),
    ).resolves.toMatchObject({
      quantity: 0,
      status: ProductStatus.SoldOut,
    });
    await expect(orderModel.findById(order.id).exec()).resolves.toMatchObject({
      status: OrderStatus.Paid,
      paymentId: payment._id,
    });
    await expect(
      paymentModel.findById(payment.id).exec(),
    ).resolves.toMatchObject({
      status: PaymentStatus.Success,
    });
    expect(
      await blockchainModel.countDocuments({ referenceId: payment._id }),
    ).toBe(1);
    // Transporters are pinged once, after commit, not again on the replay.
    expect(transport.dispatchInBackground).toHaveBeenCalledTimes(1);
  });
});
