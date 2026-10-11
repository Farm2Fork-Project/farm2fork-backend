import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaymentService } from './payment.service';
import { NotificationService } from '../notification/notification.service';
import { TransportService } from '../transport/transport.service';
import {
  Payment,
  PaymentGateway,
  PaymentStatus,
} from './schemas/payment.schema';
import { Order, OrderStatus } from '../order/schemas/order.schema';
import { Product } from '../marketplace/schemas/product.schema';
import { BlockchainTransaction } from '../blockchain/schemas/blockchain-transaction.schema';
import { SafepayClient } from './safepay/safepay.client';
import { CreatePaymentDto } from './dto/create-payment.dto';

const buyerId = new Types.ObjectId();
const orderId = new Types.ObjectId();

describe('Mobile checkout return contract', () => {
  let service: PaymentService;
  const buildCheckoutUrl = jest.fn(
    () => 'https://sandbox.api.getsafepay.com/checkout/pay',
  );
  beforeEach(async () => {
    buildCheckoutUrl.mockClear();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentService,
        {
          provide: NotificationService,
          useValue: { notifyInBackground: jest.fn() },
        },
        {
          provide: TransportService,
          useValue: { dispatchInBackground: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            safepay: {
              redirectUrl: 'https://web.example/order/complete',
              cancelUrl: 'https://web.example/order/cancel',
            },
          }),
        },
        {
          provide: getModelToken(Order.name),
          useValue: {
            findById: () => ({
              exec: () =>
                Promise.resolve({
                  _id: orderId,
                  buyerId,
                  grandTotal: 210,
                  status: OrderStatus.Pending,
                }),
            }),
          },
        },
        {
          provide: getModelToken(Payment.name),
          useValue: {
            findOne: () => ({ exec: () => Promise.resolve(null) }),
            create: (input: object) =>
              Promise.resolve({
                ...input,
                _id: new Types.ObjectId(),
                status: PaymentStatus.Pending,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
          },
        },
        { provide: getModelToken(Product.name), useValue: {} },
        { provide: getModelToken(BlockchainTransaction.name), useValue: {} },
        { provide: getConnectionToken(), useValue: {} },
        {
          provide: SafepayClient,
          useValue: {
            createTracker: () =>
              Promise.resolve({
                token: 'test-tracker',
                state: 'TRACKER_INITIATED',
              }),
            getAuthToken: () => Promise.resolve('test-token'),
            buildCheckoutUrl,
          },
        },
      ],
    }).compile();
    service = moduleRef.get(PaymentService);
  });

  it('accepts only the declared client values', async () => {
    for (const client of ['mobile', 'web']) {
      const dto = plainToInstance(CreatePaymentDto, {
        orderId: orderId.toHexString(),
        gateway: 'safepay',
        client,
      });
      expect(
        await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
      ).toHaveLength(0);
    }
    const invalid = plainToInstance(CreatePaymentDto, {
      orderId: orderId.toHexString(),
      gateway: 'safepay',
      client: 'https://attacker.example',
    });
    expect(
      await validate(invalid, { whitelist: true, forbidNonWhitelisted: true }),
    ).not.toHaveLength(0);
  });

  it.each(['mobile', 'web'])(
    'builds server-owned return URLs for %s',
    async (client) => {
      await service.initiate(
        buyerId.toHexString(),
        Object.assign(new CreatePaymentDto(), {
          orderId: orderId.toHexString(),
          gateway: PaymentGateway.Safepay,
          client,
        }),
      );
      const suffix =
        client === 'mobile' ? `?mobileOrderId=${orderId.toHexString()}` : '';
      expect(buildCheckoutUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUrl: `https://web.example/order/complete${suffix}`,
          cancelUrl: `https://web.example/order/cancel${suffix}`,
        }),
      );
    },
  );
});
