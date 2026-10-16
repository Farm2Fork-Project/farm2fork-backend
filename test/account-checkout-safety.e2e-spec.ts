import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { AdminService } from '../src/modules/admin/admin.service';
import { SystemConfigService } from '../src/modules/admin/services/system-config.service';
import {
  AuditLog,
  AuditLogSchema,
} from '../src/modules/admin/schemas/audit-log.schema';
import {
  SystemConfig,
  SystemConfigSchema,
} from '../src/modules/admin/schemas/system-config.schema';
import { User, UserSchema } from '../src/modules/auth/schemas/user.schema';
import {
  FarmerProfile,
  FarmerProfileSchema,
} from '../src/modules/auth/schemas/farmer-profile.schema';
import {
  TransporterProfile,
  TransporterProfileSchema,
} from '../src/modules/auth/schemas/transporter-profile.schema';
import {
  Product,
  ProductSchema,
} from '../src/modules/marketplace/schemas/product.schema';
import { Order, OrderSchema } from '../src/modules/order/schemas/order.schema';
import { OrderService } from '../src/modules/order/order.service';
import {
  Payment,
  PaymentGateway,
  PaymentSchema,
  PaymentStatus,
} from '../src/modules/payment/schemas/payment.schema';
import { PaymentService } from '../src/modules/payment/payment.service';
import { SafepayClient } from '../src/modules/payment/safepay/safepay.client';
import {
  Shipment,
  ShipmentSchema,
} from '../src/modules/transport/schemas/shipment.schema';
import { TransportService } from '../src/modules/transport/transport.service';
import {
  BlockchainTransaction,
  BlockchainTransactionSchema,
} from '../src/modules/blockchain/schemas/blockchain-transaction.schema';
import { NotificationService } from '../src/modules/notification/notification.service';
import { UserRole } from '../src/common/enums/user-role.enum';

jest.setTimeout(60000);
describe('Account suspension and checkout against a replica set', () => {
  let repl: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let admin: AdminService;
  let orders: OrderService;
  let payments: PaymentService;
  let users: Model<User>;
  let orderModel: Model<Order>;
  let paymentModel: Model<Payment>;
  let productModel: Model<Product>;
  let buyer: string;
  let farmer: string;
  let product: string;
  const actor = {
    id: new Types.ObjectId().toString(),
    role: UserRole.Admin,
    email: 'admin@test.com',
  };
  const address = {
    city: 'Lahore',
    province: 'Punjab',
    street: 'Test',
    lat: 31,
    lng: 70,
  };
  const gateway = {
    createTracker: jest.fn(),
    getAuthToken: jest.fn().mockResolvedValue('test-token'),
    buildCheckoutUrl: jest
      .fn()
      .mockReturnValue('https://example.test/checkout'),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
  };
  beforeAll(async () => {
    repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(repl.getUri()),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: FarmerProfile.name, schema: FarmerProfileSchema },
          { name: TransporterProfile.name, schema: TransporterProfileSchema },
          { name: Product.name, schema: ProductSchema },
          { name: Order.name, schema: OrderSchema },
          { name: Payment.name, schema: PaymentSchema },
          { name: Shipment.name, schema: ShipmentSchema },
          { name: AuditLog.name, schema: AuditLogSchema },
          { name: SystemConfig.name, schema: SystemConfigSchema },
          {
            name: BlockchainTransaction.name,
            schema: BlockchainTransactionSchema,
          },
        ]),
      ],
      providers: [
        AdminService,
        OrderService,
        PaymentService,
        SystemConfigService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            safepay: {
              redirectUrl: 'https://example.test/return',
              cancelUrl: 'https://example.test/cancel',
            },
          }),
        },
        { provide: SafepayClient, useValue: gateway },
        {
          provide: TransportService,
          useValue: { dispatchInBackground: jest.fn() },
        },
        {
          provide: NotificationService,
          useValue: { notifyInBackground: jest.fn() },
        },
      ],
    }).compile();
    admin = moduleRef.get(AdminService);
    orders = moduleRef.get(OrderService);
    payments = moduleRef.get(PaymentService);
    users = moduleRef.get(getModelToken(User.name));
    orderModel = moduleRef.get(getModelToken(Order.name));
    paymentModel = moduleRef.get(getModelToken(Payment.name));
    productModel = moduleRef.get(getModelToken(Product.name));
    await Promise.all([users.init(), orderModel.init(), paymentModel.init()]);
  });
  beforeEach(async () => {
    for (const name of [
      User.name,
      FarmerProfile.name,
      Order.name,
      Product.name,
      Payment.name,
      AuditLog.name,
      BlockchainTransaction.name,
    ])
      await moduleRef.get<Model<unknown>>(getModelToken(name)).deleteMany({});
    gateway.createTracker
      .mockReset()
      .mockResolvedValue({ token: 'test-tracker' });
    const accounts = await users.create([
      { email: 'buyer@test.com', role: UserRole.Buyer },
      { email: 'farmer@test.com', role: UserRole.Farmer },
    ]);
    buyer = String(accounts[0]._id);
    farmer = String(accounts[1]._id);
    await moduleRef
      .get<Model<FarmerProfile>>(getModelToken(FarmerProfile.name))
      .create({
        userId: farmer,
        farmName: 'Farm',
        cnic: 'test',
        farmLocation: {
          address: 'Farm road',
          city: 'Multan',
          province: 'Punjab',
          lat: 30,
          lng: 70,
        },
      });
    const listing = await productModel.create({
      farmerId: farmer,
      name: 'Tomatoes',
      category: 'vegetables',
      price: 100,
      quantity: 10,
      unit: 'kg',
    });
    product = String(listing._id);
  });
  afterAll(async () => {
    await moduleRef?.close();
    await repl?.stop();
  });
  const suspend = (account: string) =>
    admin.setUserStatus(
      account,
      { isActive: false, reason: 'Account review required' },
      actor,
    );
  const cart = () => ({
    items: [{ productId: product, quantity: 1 }],
    shippingAddress: address,
  });
  const initiate = (orderId: string) =>
    payments.initiate(buyer, { orderId, gateway: PaymentGateway.Safepay });

  it.each(['buyer', 'farmer'])(
    'preserves active %s access while a hosted checkout is payable',
    async (role) => {
      const order = await orders.create(buyer, cart());
      await initiate(order.id);
      await expect(suspend(role === 'buyer' ? buyer : farmer)).rejects.toThrow(
        /payment|paid order/i,
      );
      expect(
        (await users.findById(role === 'buyer' ? buyer : farmer))!.isActive,
      ).toBe(true);
      await payments.handleWebhook(
        PaymentGateway.Safepay,
        {
          type: 'payment.succeeded',
          data: { tracker: { token: 'test-tracker' } },
        },
        'test',
      );
      expect((await orderModel.findById(order.id))!.status).toBe('paid');
    },
  );

  it.each(['buyer', 'farmer'])(
    'protects legacy pending payment sessions when suspending the %s',
    async (role) => {
      const order = await orders.create(buyer, cart());
      await paymentModel.create({
        orderId: order.id,
        buyerId: buyer,
        amount: order.grandTotal,
        currency: 'PKR',
        gateway: 'safepay',
        gatewayRef: 'legacy-tracker',
        status: 'pending',
      });
      await expect(suspend(role === 'buyer' ? buyer : farmer)).rejects.toThrow(
        /payment|paid order/i,
      );
    },
  );

  it('settles an already-issued external callback even for legacy inactive accounts', async () => {
    const order = await orders.create(buyer, cart());
    await initiate(order.id);
    // Represents accounts disabled before these guards were deployed. Money
    // already captured externally must still receive its normal settlement.
    await users.updateMany(
      { _id: { $in: [buyer, farmer] } },
      { $set: { isActive: false } },
    );
    await payments.handleWebhook(
      PaymentGateway.Safepay,
      {
        type: 'payment.succeeded',
        data: { tracker: { token: 'test-tracker' } },
      },
      'test',
    );
    expect((await orderModel.findById(order.id))!.status).toBe('paid');
    expect((await paymentModel.findOne({ orderId: order.id }))!.status).toBe(
      'success',
    );
    expect((await productModel.findById(product))!.quantity).toBe(9);
  });

  it('rejects fresh quotes and orders after the farmer is suspended', async () => {
    await suspend(farmer);
    await expect(orders.quote(cart())).rejects.toThrow(
      /farm.*available|inactive/i,
    );
    await expect(orders.create(buyer, cart())).rejects.toThrow(
      /farm.*available|inactive/i,
    );
    expect(await orderModel.countDocuments()).toBe(0);
  });

  it.each(['buyer', 'farmer'])(
    'cannot make an existing unpaid draft payable after %s suspension',
    async (role) => {
      const order = await orders.create(buyer, cart());
      await suspend(role === 'buyer' ? buyer : farmer);
      await expect(initiate(order.id)).rejects.toThrow(
        /account|farm.*available|inactive/i,
      );
      expect(await paymentModel.countDocuments()).toBe(0);
      expect(
        (await orderModel.findById(order.id))!.paymentStartedAt,
      ).toBeUndefined();
    },
  );

  it('protects both accounts before gateway issuance finishes, even if the gateway fails', async () => {
    const order = await orders.create(buyer, cart());
    let entered!: () => void;
    let rejectGateway!: (error: Error) => void;
    const reachedGateway = new Promise<void>((resolve) => {
      entered = resolve;
    });
    gateway.createTracker.mockImplementationOnce(() => {
      entered();
      return new Promise((_, reject) => {
        rejectGateway = reject;
      });
    });
    const payment = initiate(order.id);
    const failure = expect(payment).rejects.toThrow('Gateway disconnected');
    await reachedGateway;
    try {
      await expect(suspend(buyer)).rejects.toThrow(/payment|paid order/i);
      await expect(suspend(farmer)).rejects.toThrow(/payment|paid order/i);
    } finally {
      rejectGateway(new Error('Gateway disconnected'));
    }
    await failure;
    expect(await paymentModel.countDocuments()).toBe(0);
    await expect(suspend(buyer)).rejects.toThrow(/payment|paid order/i);
  });

  it.each(['buyer', 'farmer'])(
    'serializes concurrent %s suspension against payable checkout issuance',
    async (role) => {
      const order = await orders.create(buyer, cart());
      const accountId = role === 'buyer' ? buyer : farmer;
      const results = await Promise.allSettled([
        suspend(accountId),
        initiate(order.id),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const active = (await users.findById(accountId))!.isActive;
      const pending = await paymentModel.findOne({
        orderId: order.id,
        status: PaymentStatus.Pending,
      });
      expect(Boolean(pending)).toBe(active);
    },
  );
});
