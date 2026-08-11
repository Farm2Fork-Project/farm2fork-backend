import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  ForbiddenException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  BlockchainTransaction,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../blockchain/schemas/blockchain-transaction.schema';
import {
  Product,
  ProductStatus,
} from '../marketplace/schemas/product.schema';
import { Order, OrderStatus } from '../order/schemas/order.schema';
import { Payment, PaymentGateway, PaymentStatus } from './schemas/payment.schema';
import { PaymentService } from './payment.service';

const query = <T>(value: T) => ({
  exec: jest.fn<() => Promise<T>>().mockResolvedValue(value),
});

const transactionQuery = <T>(value: T) => ({
  session: jest.fn().mockReturnThis(),
  exec: jest.fn<() => Promise<T>>().mockResolvedValue(value),
});

const buyerId = '66a2fe77bb77795516febc22';
const otherBuyerId = '66a2fe77bb77795516febc23';
const orderId = '66a2fe77bb77795516febc50';

const makeOrder = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(orderId),
  buyerId: new Types.ObjectId(buyerId),
  grandTotal: 870,
  status: OrderStatus.Pending,
  ...overrides,
});

const makePayment = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  id: 'payment-1',
  orderId: new Types.ObjectId(orderId),
  buyerId: new Types.ObjectId(buyerId),
  amount: 870,
  currency: 'PKR',
  gateway: PaymentGateway.JazzCash,
  status: PaymentStatus.Pending,
  createdAt: new Date('2026-08-11T00:00:00.000Z'),
  updatedAt: new Date('2026-08-11T00:00:00.000Z'),
  save: jest.fn(),
  ...overrides,
});

describe('PaymentService', () => {
  let service: PaymentService;
  let orderModel: { findById: jest.Mock };
  let paymentModel: {
    findOne: jest.Mock;
    findById: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    create: jest.Mock;
  };
  let productModel: { updateOne: jest.Mock };
  let blockchainModel: { create: jest.Mock };
  let connection: { startSession: jest.Mock };
  let session: { withTransaction: jest.Mock; endSession: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    orderModel = { findById: jest.fn() };
    paymentModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      create: jest.fn(),
    };
    productModel = { updateOne: jest.fn() };
    blockchainModel = { create: jest.fn() };
    session = {
      withTransaction: jest.fn(async (callback: () => Promise<unknown>) =>
        callback(),
      ),
      endSession: jest.fn(),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    config = { get: jest.fn().mockReturnValue(true) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: getModelToken(Product.name), useValue: productModel },
        {
          provide: getModelToken(BlockchainTransaction.name),
          useValue: blockchainModel,
        },
        { provide: getConnectionToken(), useValue: connection },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = moduleRef.get(PaymentService);
  });

  it('creates one pending payment using the persisted order total', async () => {
    const order = makeOrder();
    orderModel.findById.mockReturnValue(query(order));
    paymentModel.findOne.mockReturnValue(query(null));
    paymentModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      orderId: order._id,
      buyerId: order.buyerId,
      amount: order.grandTotal,
      currency: 'PKR',
      gateway: PaymentGateway.JazzCash,
      status: PaymentStatus.Pending,
      createdAt: new Date('2026-08-11T00:00:00.000Z'),
      updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    });

    const result = await service.initiate(buyerId, {
      orderId,
      gateway: PaymentGateway.JazzCash,
    });

    expect(result.payment.amount).toBe(870);
    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order._id,
        buyerId: order.buyerId,
        amount: 870,
        status: PaymentStatus.Pending,
      }),
    );
  });

  it('rejects payment initiation for an order owned by another buyer', async () => {
    orderModel.findById.mockReturnValue(
      query(makeOrder({ buyerId: new Types.ObjectId(otherBuyerId) })),
    );

    await expect(
      service.initiate(buyerId, {
        orderId,
        gateway: PaymentGateway.JazzCash,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(paymentModel.create).not.toHaveBeenCalled();
  });

  it('returns the existing pending payment instead of creating a duplicate', async () => {
    const existing = makePayment({ id: 'pending-payment' });
    orderModel.findById.mockReturnValue(query(makeOrder()));
    paymentModel.findOne.mockReturnValue(query(existing));

    const result = await service.initiate(buyerId, {
      orderId,
      gateway: PaymentGateway.JazzCash,
    });

    expect(result.payment.id).toBe('pending-payment');
    expect(paymentModel.create).not.toHaveBeenCalled();
  });

  it('reuses a failed payment record when the buyer retries', async () => {
    const failed = makePayment({
      id: 'failed-payment',
      status: PaymentStatus.Failed,
      failedAt: new Date('2026-08-11T00:02:00.000Z'),
    });
    failed.save.mockResolvedValue(failed);
    orderModel.findById.mockReturnValue(query(makeOrder()));
    paymentModel.findOne.mockReturnValue(query(failed));

    const result = await service.initiate(buyerId, {
      orderId,
      gateway: PaymentGateway.Stripe,
    });

    expect(result.payment.id).toBe('failed-payment');
    expect(failed.status).toBe(PaymentStatus.Pending);
    expect(failed.gateway).toBe(PaymentGateway.Stripe);
    expect(failed.failedAt).toBeUndefined();
    expect(failed.save).toHaveBeenCalledTimes(1);
    expect(paymentModel.create).not.toHaveBeenCalled();
  });

  it('settles a pending payment once with order, stock, and blockchain state', async () => {
    const productId = new Types.ObjectId();
    const payment = makePayment({ id: 'payment-to-settle' });
    payment.save.mockResolvedValue(payment);
    const order = makeOrder({
      items: [{ productId, quantity: 2 }],
      paymentId: undefined,
      save: jest.fn(),
    });
    order.save.mockResolvedValue(order);
    const blockchainRecord = { _id: new Types.ObjectId() };

    paymentModel.findOne.mockReturnValue(transactionQuery(payment));
    orderModel.findById.mockReturnValue(transactionQuery(order));
    productModel.updateOne.mockReturnValue(
      transactionQuery({ modifiedCount: 1 }),
    );
    blockchainModel.create.mockResolvedValue([blockchainRecord]);

    const result = await service.simulate(
      'payment-to-settle',
      buyerId,
      PaymentStatus.Success,
    );

    expect(result.status).toBe(PaymentStatus.Success);
    expect(payment.status).toBe(PaymentStatus.Success);
    expect(order.status).toBe(OrderStatus.Paid);
    expect(order.paymentId).toEqual(payment._id);
    expect(productModel.updateOne).toHaveBeenCalledWith(
      { _id: productId, quantity: { $gte: 2 } },
      { $inc: { quantity: -2 } },
      { session },
    );
    expect(blockchainModel.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: BlockchainTxType.Payment,
          status: BlockchainTxStatus.Pending,
          referenceId: payment._id,
        }),
      ],
      { session },
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('records a failed payment without changing stock, order, or blockchain state', async () => {
    const payment = makePayment({ id: 'payment-to-fail' });
    payment.save.mockResolvedValue(payment);
    paymentModel.findOne.mockReturnValue(transactionQuery(payment));

    const result = await service.simulate(
      'payment-to-fail',
      buyerId,
      PaymentStatus.Failed,
    );

    expect(result.status).toBe(PaymentStatus.Failed);
    expect(payment.status).toBe(PaymentStatus.Failed);
    expect(payment.failedAt).toBeInstanceOf(Date);
    expect(productModel.updateOne).not.toHaveBeenCalled();
    expect(orderModel.findById).not.toHaveBeenCalled();
    expect(blockchainModel.create).not.toHaveBeenCalled();
  });

  it('marks a product sold out when settlement reduces stock to zero', async () => {
    const productId = new Types.ObjectId();
    const payment = makePayment();
    payment.save.mockResolvedValue(payment);
    const order = makeOrder({
      items: [{ productId, quantity: 2 }],
      save: jest.fn(),
    });
    order.save.mockResolvedValue(order);

    paymentModel.findOne.mockReturnValue(transactionQuery(payment));
    orderModel.findById.mockReturnValue(transactionQuery(order));
    productModel.updateOne
      .mockReturnValueOnce(transactionQuery({ modifiedCount: 1 }))
      .mockReturnValueOnce(transactionQuery({ modifiedCount: 1 }));
    blockchainModel.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

    await service.simulate(payment.id, buyerId, PaymentStatus.Success);

    expect(productModel.updateOne).toHaveBeenLastCalledWith(
      { _id: productId, quantity: 0 },
      { $set: { status: ProductStatus.SoldOut } },
      { session },
    );
  });

  it('rejects public webhooks until provider signature verification exists', () => {
    expect(() =>
      service.handleWebhook(PaymentGateway.JazzCash, {
        gatewayRef: 'unverified-reference',
        status: PaymentStatus.Success,
      }),
    ).toThrow(NotImplementedException);
  });

  it('lists persisted payments scoped to the requesting buyer', async () => {
    const payment = makePayment({ id: 'persisted-payment' });
    paymentModel.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([payment]),
    });
    paymentModel.countDocuments.mockReturnValue(query(1));

    const result = await service.findAll(
      { id: buyerId, role: UserRole.Buyer },
      { page: 1, limit: 10, status: PaymentStatus.Pending },
    );

    expect(result.data.map((item) => item.id)).toEqual(['persisted-payment']);
    expect(result.total).toBe(1);
    expect(paymentModel.find).toHaveBeenCalledWith({
      buyerId: new Types.ObjectId(buyerId),
      status: PaymentStatus.Pending,
    });
  });

  it('does not expose a payment to another buyer', async () => {
    paymentModel.findById.mockReturnValue(query(makePayment()));

    await expect(
      service.findOne('66a2fe77bb77795516febc77', {
        id: otherBuyerId,
        role: UserRole.Buyer,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns not found for an invalid persisted payment id', async () => {
    await expect(
      service.findOne('not-an-object-id', {
        id: buyerId,
        role: UserRole.Buyer,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not allow simulated settlement when the simulator is disabled', async () => {
    config.get.mockReturnValue(false);

    await expect(
      service.simulate('payment-disabled', buyerId, PaymentStatus.Success),
    ).rejects.toThrow('Payment simulator is not enabled');
    expect(connection.startSession).not.toHaveBeenCalled();
  });
});
