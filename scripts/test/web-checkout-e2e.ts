/** Real web components/repository -> Nest HTTP/JWT -> MongoDB transactions.
 * Safepay tracker/passport endpoints use local HTTP fixtures. Notifications are persisted;
 * push delivery needs a real device. Transport and ledger outbox persistence are real.
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
import { FIREBASE_APP } from '../../src/infrastructure/firebase/firebase.constants';
import { NotificationController } from '../../src/modules/notification/notification.controller';
import {
  Notification,
  NotificationSchema,
  NotificationType,
} from '../../src/modules/notification/schemas/notification.schema';
import { BlockchainOutboxWorker } from '../../src/modules/blockchain/blockchain-outbox.worker';
import { FabricGatewayService } from '../../src/modules/blockchain/fabric-gateway.service';
import { FabricGatewayRuntimeService } from '../../src/modules/blockchain/fabric-gateway.runtime';
import { NotificationService } from '../../src/modules/notification/notification.service';
import { TransportController } from '../../src/modules/transport/transport.controller';
import {
  Shipment,
  ShipmentSchema,
  ShipmentStatus,
} from '../../src/modules/transport/schemas/shipment.schema';
import {
  TransporterProfile,
  TransporterProfileSchema,
  VehicleType,
} from '../../src/modules/auth/schemas/transporter-profile.schema';
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
  BlockchainTransactionDocument,
  BlockchainTxStatus,
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
  let fabricRuntime: FabricGatewayRuntimeService | undefined;
  try {
    await new Promise<void>((done) => gateway.listen(0, '127.0.0.1', done));
    const gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: Product.name, schema: ProductSchema },
          { name: Shipment.name, schema: ShipmentSchema },
          { name: TransporterProfile.name, schema: TransporterProfileSchema },
          { name: FarmerProfile.name, schema: FarmerProfileSchema },
          { name: User.name, schema: UserSchema },
          { name: Notification.name, schema: NotificationSchema },
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
        TransportController,
        NotificationController,
      ],
      providers: [
        FarmerProfileService,
        MarketplaceService,
        OrderService,
        NotificationService,
        { provide: FIREBASE_APP, useValue: null },
        TransportService,
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
    const transporters = await users.create([
      { email: 'transporter-one@example.test', role: UserRole.Transporter },
      { email: 'transporter-two@example.test', role: UserRole.Transporter },
    ]);
    await moduleRef
      .get<Model<TransporterProfile>>(getModelToken(TransporterProfile.name))
      .create(
        transporters.map((user, index) => ({
          userId: user._id,
          vehicleType: VehicleType.Van,
          vehicleNumber: `FIX-${index}`,
          licenseNumber: `fixture-${index}`,
          cnic: `352021234569${index}`,
          isAvailable: index === 1,
          ...(index === 1
            ? {
                lastLocation: { type: 'Point', coordinates: [74.35, 31.52] },
                lastLocationAt: new Date(),
              }
            : {}),
        })),
      );
    await Promise.all([
      moduleRef.get<Model<Order>>(getModelToken(Order.name)).init(),
      moduleRef.get<Model<Shipment>>(getModelToken(Shipment.name)).init(),
      moduleRef
        .get<Model<TransporterProfile>>(getModelToken(TransporterProfile.name))
        .init(),
    ]);
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
    const delivery = process.argv.includes('--delivery');
    const mobile = process.argv.includes('--mobile');
    const exitCode = await new Promise<number>((done, reject) => {
      const fixtureEnv = {
        CHECKOUT_TEST_API: apiUrl,
        CHECKOUT_TEST_DELIVERY: delivery ? 'true' : 'false',
        CHECKOUT_TEST_TRANSPORTER_ID: transporters[0]._id.toHexString(),
        CHECKOUT_TEST_TRANSPORTER_TOKEN: token(transporters[0]),
        CHECKOUT_TEST_SECOND_TRANSPORTER_TOKEN: token(transporters[1]),
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
      records.length !== (delivery ? 10 : 2) ||
      orders.some(
        (order) =>
          order.status !==
          (delivery ? OrderStatus.Delivered : OrderStatus.Paid),
      ) ||
      payments.some((payment) => payment.status !== PaymentStatus.Success) ||
      (await products.countDocuments({
        quantity: 0,
        status: ProductStatus.SoldOut,
      })) !== 2
    ) {
      throw new Error('Unexpected persisted checkout result');
    }
    if (delivery) {
      const shipments = await moduleRef
        .get<Model<Shipment>>(getModelToken(Shipment.name))
        .find()
        .exec();
      if (
        shipments.length !== 2 ||
        shipments.some(
          (s) =>
            s.status !== ShipmentStatus.Delivered ||
            s.statusHistory.length !== 4,
        )
      )
        throw new Error('Unexpected delivery result');
    }
    // Background notification persistence can finish after the HTTP response.
    const notificationModel = moduleRef.get<Model<Notification>>(
      getModelToken(Notification.name),
    );
    const expectedBuyer = delivery ? 12 : 4;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        (await notificationModel.countDocuments({ userId: buyer._id })) ===
        expectedBuyer
      )
        break;
      await new Promise<void>((done) => setTimeout(done, 100));
    }
    const requestAs = async (
      authToken: string,
      path: string,
      method = 'GET',
      body?: unknown,
    ) => {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Farm2Fork-CSRF': '1',
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return response;
    };
    const inboxResponse = await requestAs(
      token(buyer),
      '/notifications?limit=50',
    );
    const inbox = (await inboxResponse.json()) as {
      total: number;
      unread: number;
      data: Array<{
        id: string;
        type: NotificationType;
        relatedEntityId?: string;
      }>;
    };
    if (
      !inboxResponse.ok ||
      inbox.total !== expectedBuyer ||
      inbox.unread !== expectedBuyer ||
      inbox.data.filter((n) => n.type === NotificationType.PaymentConfirmed)
        .length !== 2 ||
      (delivery &&
        inbox.data.filter((n) => n.type === NotificationType.DeliveryUpdate)
          .length !== 6)
    ) {
      throw new Error(
        `Buyer notification persistence or replay deduplication failed: HTTP ${inboxResponse.status}, total ${inbox.total}, unread ${inbox.unread}`,
      );
    }
    for (const farmer of farmers) {
      const response = await requestAs(
        token(farmer),
        '/notifications?limit=50',
      );
      const page = (await response.json()) as { total: number };
      if (!response.ok || page.total !== (delivery ? 6 : 2))
        throw new Error('Farmer notification inbox mismatch');
    }
    const competitorNotices = await notificationModel
      .find({
        userId: transporters[1]._id,
        type: NotificationType.DeliveryOffer,
      })
      .exec();
    if (
      competitorNotices.length !== 2 ||
      new Set(competitorNotices.map((n) => String(n.relatedEntityId))).size !==
        2
    )
      throw new Error(
        'Delivery offer notification or payment replay deduplication failed',
      );
    if (
      delivery &&
      (await notificationModel.countDocuments({
        userId: transporters[0]._id,
        type: NotificationType.ShipmentAssigned,
      })) !== 2
    )
      throw new Error('Transporter assignment notification mismatch');
    console.log(
      'PASS: farmer order/payment/delivery inboxes and transporter offer/assignment notifications',
    );
    const foreignRead = await requestAs(
      token(otherBuyer),
      `/notifications/${inbox.data[0].id}/read`,
      'PATCH',
    );
    if (foreignRead.status !== 404)
      throw new Error('Notification ownership check failed');
    if (
      !(
        await requestAs(
          token(buyer),
          `/notifications/${inbox.data[0].id}/read`,
          'PATCH',
        )
      ).ok ||
      !(await requestAs(token(buyer), '/notifications/read-all', 'POST')).ok
    )
      throw new Error('Notification read update failed');
    const unreadResponse = await requestAs(
      token(buyer),
      '/notifications/unread-count',
    );
    if (((await unreadResponse.json()) as { unread: number }).unread !== 0)
      throw new Error('Notification unread count did not clear');
    // A fixture token tests account binding only; it is never sent to FCM.
    const fixtureToken = `fixture-${randomUUID()}`;
    if (
      (
        await requestAs(token(buyer), '/notifications/device-token', 'PUT', {
          token: fixtureToken,
        })
      ).status !== 204 ||
      (
        await requestAs(
          token(otherBuyer),
          '/notifications/device-token',
          'PUT',
          { token: fixtureToken },
        )
      ).status !== 204 ||
      (await users.countDocuments({ fcmToken: fixtureToken })) !== 1
    )
      throw new Error('Device token account handover failed');
    if (
      (
        await requestAs(
          token(otherBuyer),
          '/notifications/device-token',
          'DELETE',
        )
      ).status !== 204 ||
      (await users.countDocuments({ fcmToken: fixtureToken })) !== 0
    )
      throw new Error('Device token cleanup failed');
    console.log(
      `PASS: real notification inbox (${expectedBuyer} buyer records), ownership, read/unread and device-token handover`,
    );

    if (process.argv.includes('--fabric')) {
      const crypto = resolve(
        __dirname,
        '../../../farm2fork-blockchain/network/organizations/peerOrganizations/farm2fork.com',
      );
      const fabricConfig = new ConfigService({
        blockchain: {
          enabled: true,
          channelName: 'farm2forkchannel',
          chaincodeName: 'farm2fork-chaincode',
          mspId: 'Farm2ForkMSP',
          peerEndpoint: process.env.FABRIC_PEER_ENDPOINT ?? 'localhost:7051',
          peerHostAlias: 'peer0.farm2fork.com',
          tlsRootCertPath: resolve(
            crypto,
            'peers/peer0.farm2fork.com/tls/ca.crt',
          ),
          identityCertPath: resolve(
            crypto,
            'users/Admin@farm2fork.com/msp/signcerts/Admin@farm2fork.com-cert.pem',
          ),
          identityKeyPath: resolve(
            crypto,
            'users/Admin@farm2fork.com/msp/keystore/priv_sk',
          ),
          leaseDurationMs: 30000,
          retryBaseDelayMs: 100,
        },
      });
      fabricRuntime = new FabricGatewayRuntimeService(fabricConfig);
      const fabric = new FabricGatewayService(fabricConfig, fabricRuntime);
      await fabric.onModuleInit();
      const outbox = moduleRef.get<Model<BlockchainTransactionDocument>>(
        getModelToken(BlockchainTransaction.name),
      );
      const worker = new BlockchainOutboxWorker(outbox, fabricConfig, fabric);
      for (let attempt = 0; attempt < records.length * 4; attempt++) {
        if (
          (await outbox.countDocuments({ status: 'confirmed' })) ===
          records.length
        )
          break;
        if (!(await worker.processNext()))
          await new Promise<void>((done) => setTimeout(done, 250));
      }
      const confirmed = await outbox.find().exec();
      for (const record of confirmed) {
        if (
          record.status !== BlockchainTxStatus.Confirmed ||
          !record.txHash ||
          !record.blockNumber
        ) {
          throw new Error(
            `Fabric outbox ${record.id} failed: ${record.lastErrorCode ?? record.status} ${record.lastErrorMessage ?? ''}`,
          );
        }
        const ledger = await fabric.findByLedgerKey(record._id.toHexString());
        if (
          ledger?.referenceId !== String(record.referenceId) ||
          ledger.txHash !== record.txHash
        )
          throw new Error('Fabric independent readback mismatch');
      }
      if (await worker.processNext())
        throw new Error('Confirmed outbox was submitted again');
      console.log(
        `PASS: ${records.length} real Fabric commits and independent ledger readbacks; confirmed outbox replay is idle`,
      );
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
      `PASS: ${mobile ? 'mobile' : 'web'} checkout/return/retry -> real HTTP/JWT/CSRF -> MongoDB -> ${delivery ? 'two delivered orders, shipments and ten ledger outbox records' : 'exactly two paid orders and ledger outbox records'}`,
    );
  } finally {
    fabricRuntime?.close();
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
