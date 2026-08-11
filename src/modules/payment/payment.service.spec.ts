import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { Order, OrderStatus } from '../order/schemas/order.schema';
import { Payment, PaymentGateway, PaymentStatus } from './schemas/payment.schema';
import { PaymentService } from './payment.service';

const query = <T>(value: T) => ({
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
  let paymentModel: { findOne: jest.Mock; create: jest.Mock };

  beforeEach(async () => {
    orderModel = { findById: jest.fn() };
    paymentModel = { findOne: jest.fn(), create: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(Payment.name), useValue: paymentModel },
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
});
