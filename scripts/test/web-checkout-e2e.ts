/** Real web components/repository -> Nest HTTP/JWT -> MongoDB transactions.
 * Safepay tracker/passport endpoints use local HTTP fixtures. Notification and
 * transport dispatch are stubbed; ledger outbox persistence is real.
 * Firebase session acquisition and the hosted provider UI are outside this test.
 */
import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { User, UserSchema } from '../../src/modules/auth/schemas/user.schema';
import { UserRole } from '../../src/common/enums/user-role.enum';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { FirebaseSessionAuthGuard } from '../../src/common/guards/firebase-session-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { CsrfGuard } from '../../src/common/guards/csrf.guard';
import { MarketplaceController } from '../../src/modules/marketplace/marketplace.controller';
import { MarketplaceService } from '../../src/modules/marketplace/marketplace.service';
import {
  FarmerProfile,
  FarmerProfileSchema,
} from '../../src/modules/auth/schemas/farmer-profile.schema';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { TransportService } from '../../src/modules/transport/transport.service';
import {
  FarmerProfileController,
  FarmerProfileService,
} from '../../src/modules/auth/farmer-profile.controller';
import {
  Product,
  ProductSchema,
  ProductStatus,
  ProductUnit,
} from '../../src/modules/marketplace/schemas/product.schema';
import {
  Order,
  OrderSchema,
  OrderStatus,
} from '../../src/modules/order/schemas/order.schema';
import { OrderController } from '../../src/modules/order/order.controller';
import { OrderService } from '../../src/modules/order/order.service';
import {
  Payment,
  PaymentSchema,
  PaymentStatus,
} from '../../src/modules/payment/schemas/payment.schema';
import { PaymentController } from '../../src/modules/payment/payment.controller';
import { PaymentService } from '../../src/modules/payment/payment.service';
import { SafepayClient } from '../../src/modules/payment/safepay/safepay.client';
import {
  BlockchainTransaction,
  BlockchainTransactionSchema,
} from '../../src/modules/blockchain/schemas/blockchain-transaction.schema';
import {
  SystemConfig,
  SystemConfigSchema,
} from '../../src/modules/admin/schemas/system-config.schema';
import { SystemConfigService } from '../../src/modules/admin/services/system-config.service';

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const jwtSecret = randomBytes(32).toString('hex');
  const webhookSecret = randomBytes(32).toString('hex');
  const trackerRequests: Array<{
    amount: number;
    metadata: { order_id: string };
  }> = [];
  const gateway = createServer((req, res) => {
    void (async () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method !== 'POST') {
        res.writeHead(405).end('{}');
        return;
      }
      if (req.url === '/order/payments/v3/') {
        let body = '';
        for await (const chunk of req) body += String(chunk);
        trackerRequests.push(
          JSON.parse(body) as (typeof trackerRequests)[number],
        );
        res.end(
          JSON.stringify({
            data: {
              tracker: { token: randomUUID(), state: 'TRACKER_INITIATED' },
            },
          }),
        );
      } else if (req.url === '/client/passport/v1/token') {
        res.end(JSON.stringify({ data: 'test-only-passport-token' }));
      } else {
        res.writeHead(404).end('{}');
      }
    })().catch(() => {
      res.writeHead(500).end('{}');
    });
  });
  let moduleRef: TestingModule | undefined;
  let server: INestApplication | undefined;
  try {
    await new Promise<void>((done) => gateway.listen(0, '127.0.0.1', done));
    const gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: Product.name, schema: ProductSchema },
          { name: FarmerProfile.name, schema: FarmerProfileSchema },
          { name: User.name, schema: UserSchema },
          { name: Order.name, schema: OrderSchema },
          { name: Payment.name, schema: PaymentSchema },
          {
            name: BlockchainTransaction.name,
            schema: BlockchainTransactionSchema,
          },
          { name: SystemConfig.name, schema: SystemConfigSchema },
        ]),
      ],
      controllers: [
        MarketplaceController,
        OrderController,
        PaymentController,
        FarmerProfileController,
      ],
      providers: [
        FarmerProfileService,
        MarketplaceService,
        OrderService,
        {
          provide: NotificationService,
          useValue: { notifyInBackground: () => undefined },
        },
        {
          provide: TransportService,
          useValue: { dispatchInBackground: () => undefined },
        },
        PaymentService,
        SafepayClient,
        SystemConfigService,
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        CsrfGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            JWT_SECRET: jwtSecret,
            WEB_APP_ORIGIN: 'http://checkout.example.test',
            safepay: {
              enabled: true,
              environment: 'sandbox',
              apiBaseUrl: gatewayUrl,
              checkoutBaseUrl: 'https://sandbox.api.getsafepay.com/checkout',
              publicKey: 'test-public-key',
              secretKey: 'test-secret-key',
              webhookSecret,
              redirectUrl: 'http://checkout.example.test/order/complete',
              cancelUrl: 'http://checkout.example.test/order/cancel',
            },
          }),
        },
        {
          provide: FirebaseSessionAuthGuard,
          useValue: {
            canActivate: () => {
              throw new UnauthorizedException(
                'Harness requires test bearer auth',
              );
            },
          },
        },
      ],
    }).compile();
    server = moduleRef.createNestApplication();
    server.setGlobalPrefix('api');
    server.useGlobalGuards(
      moduleRef.get(CsrfGuard),
      moduleRef.get(JwtAuthGuard),
      moduleRef.get(RolesGuard),
    );
    server.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await server.listen(0, '127.0.0.1');
    const users = moduleRef.get<Model<User>>(getModelToken(User.name));
    const buyer = await users.create({
      email: 'checkout-buyer@example.test',
      role: UserRole.Buyer,
    });
    const otherBuyer = await users.create({
      email: 'other-buyer@example.test',
      role: UserRole.Buyer,
    });
    const farmers = await users.create([
      { email: 'farmer-one@example.test', role: UserRole.Farmer },
      { email: 'farmer-two@example.test', role: UserRole.Farmer },
    ]);
    await moduleRef
      .get<Model<FarmerProfile>>(getModelToken(FarmerProfile.name))
      .create(
        farmers.map((farmer, index) => ({
          userId: farmer._id,
          farmName: `Fixture farm ${index + 1}`,
          cnic: `352021234567${index}`,
        })),
      );
    const products = moduleRef.get<Model<Product>>(getModelToken(Product.name));
    await products.create(
      farmers.map((farmer, index) => ({
        farmerId: farmer._id,
        name: `Checkout tomatoes ${index + 1}`,
        category: 'vegetables',
        price: 100,
        quantity: 2,
        unit: ProductUnit.Kg,
        status: ProductStatus.Active,
      })),
    );
    await moduleRef
      .get<Model<SystemConfig>>(getModelToken(SystemConfig.name))
      .create({ key: 'platform_fee_percent', value: 5 });
    const jwt = new JwtService({ secret: jwtSecret });
    const token = (user: typeof buyer) =>
      jwt.sign(
        { sub: user._id.toHexString(), role: user.role, email: user.email },
        { expiresIn: '10m' },
      );
    const apiUrl = `${await server.getUrl()}/api`;
    const mobile = process.argv.includes('--mobile');
    const exitCode = await new Promise<number>((done, reject) => {
      const fixtureEnv = {
        CHECKOUT_TEST_API: apiUrl,
        CHECKOUT_TEST_BUYER_ID: buyer._id.toHexString(),
        CHECKOUT_TEST_BUYER_TOKEN: token(buyer),
        CHECKOUT_TEST_OTHER_TOKEN: token(otherBuyer),
        CHECKOUT_TEST_FARMER_TOKEN: token(farmers[0]),
        CHECKOUT_TEST_SECOND_FARMER_TOKEN: token(farmers[1]),
        CHECKOUT_TEST_WEBHOOK_SECRET: webhookSecret,
      };
      const child = spawn(
        mobile ? (process.env.FLUTTER_BIN ?? 'flutter') : 'pnpm',
        mobile
          ? [
              'test',
              'test/payments/live_payment_flow_test.dart',
              '--no-pub',
              ...Object.entries(fixtureEnv).map(
                ([key, value]) => `--dart-define=${key}=${value}`,
              ),
            ]
          : ['exec', 'vitest', 'run', 'test/live-checkout-flow.test.tsx'],
        {
          cwd: resolve(
            __dirname,
            mobile ? '../../../farm2fork-mobile' : '../../../farm2fork-web',
          ),
          stdio: 'inherit',
          env: { ...process.env, ...fixtureEnv },
        },
      );
      child.on('error', reject);
      child.on('exit', (code) => done(code ?? 1));
    });
    if (exitCode !== 0) throw new Error(`Checkout E2E failed (${exitCode})`);
    const orders = await moduleRef
      .get<Model<Order>>(getModelToken(Order.name))
      .find()
      .exec();
    const payments = await moduleRef
      .get<Model<Payment>>(getModelToken(Payment.name))
      .find()
      .exec();
    const records = await moduleRef
      .get<
        Model<BlockchainTransaction>
      >(getModelToken(BlockchainTransaction.name))
      .find()
      .exec();
    if (
      orders.length !== 2 ||
      payments.length !== 2 ||
      records.length !== 2 ||
      orders.some((order) => order.status !== OrderStatus.Paid) ||
      payments.some((payment) => payment.status !== PaymentStatus.Success) ||
      (await products.countDocuments({
        quantity: 0,
        status: ProductStatus.SoldOut,
      })) !== 2
    ) {
      throw new Error('Unexpected persisted checkout result');
    }
    if (
      trackerRequests.length !== 4 ||
      trackerRequests.some(
        (body) =>
          !orders.some(
            (order) =>
              order.id === body.metadata.order_id &&
              body.amount === Math.round(order.grandTotal * 100) &&
              order.deliveryFee > 0,
          ),
      )
    ) {
      throw new Error('Unexpected gateway amount or resume order reference');
    }
    console.log(
      `PASS: ${mobile ? 'mobile' : 'web'} checkout/return/retry -> real HTTP/JWT/CSRF -> MongoDB -> exactly two paid orders and ledger outbox records`,
    );
  } finally {
    await server?.close();
    if (!server) await moduleRef?.close();
    if (gateway.listening)
      await new Promise<void>((done, reject) =>
        gateway.close((error) => (error ? reject(error) : done())),
      );
    await mongo.stop();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
