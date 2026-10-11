/** Isolated mobile repository -> real Nest HTTP -> MongoDB lifecycle test.
 * Firebase account acquisition is outside this harness: only short-lived signed
 * test JWTs are seeded. JWT validation, role checks and ownership are real.
 */
import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
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
import { MarketplaceController } from '../../src/modules/marketplace/marketplace.controller';
import { MarketplaceService } from '../../src/modules/marketplace/marketplace.service';
import {
  Product,
  ProductSchema,
} from '../../src/modules/marketplace/schemas/product.schema';
import {
  FarmerProfile,
  FarmerProfileSchema,
} from '../../src/modules/auth/schemas/farmer-profile.schema';
import {
  BlockchainTransaction,
  BlockchainTransactionSchema,
} from '../../src/modules/blockchain/schemas/blockchain-transaction.schema';
import { User, UserSchema } from '../../src/modules/auth/schemas/user.schema';
import { UserRole } from '../../src/common/enums/user-role.enum';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { FirebaseSessionAuthGuard } from '../../src/common/guards/firebase-session-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { CsrfGuard } from '../../src/common/guards/csrf.guard';

async function main() {
  // Listing + origin outbox creation uses a real MongoDB transaction.
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const secret = randomBytes(32).toString('hex');
  let app: TestingModule | undefined;
  let server: INestApplication | undefined;
  try {
    app = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongo.getUri()),
        MongooseModule.forFeature([
          { name: User.name, schema: UserSchema },
          { name: Product.name, schema: ProductSchema },
          { name: FarmerProfile.name, schema: FarmerProfileSchema },
          {
            name: BlockchainTransaction.name,
            schema: BlockchainTransactionSchema,
          },
        ]),
      ],
      // Mount the production controller/service without initializing unrelated
      // Firebase login or Fabric workers; JWT/roles and persistence stay real.
      controllers: [MarketplaceController],
      providers: [
        MarketplaceService,
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        CsrfGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({ JWT_SECRET: secret }),
        },
        {
          provide: FirebaseSessionAuthGuard,
          useValue: {
            canActivate: () => {
              throw new UnauthorizedException(
                'Test harness requires bearer auth',
              );
            },
          },
        },
      ],
    }).compile();
    server = app.createNestApplication();
    server.setGlobalPrefix('api');
    server.useGlobalGuards(
      app.get(CsrfGuard),
      app.get(JwtAuthGuard),
      app.get(RolesGuard),
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
    const users = app.get<Model<User>>(getModelToken(User.name));
    const owner = await users.create({
      email: 'owner@example.test',
      role: UserRole.Farmer,
    });
    const other = await users.create({
      email: 'other@example.test',
      role: UserRole.Farmer,
    });
    const buyer = await users.create({
      email: 'buyer@example.test',
      role: UserRole.Buyer,
    });
    await app
      .get<Model<FarmerProfile>>(getModelToken(FarmerProfile.name))
      .create({
        userId: owner._id,
        farmName: 'E2E Mango Farm',
        cnic: 'test-only-farmer-id',
        farmLocation: {
          lat: 31.52,
          lng: 74.35,
          address: 'Test farm',
          city: 'Lahore',
          province: 'Punjab',
        },
      });
    const jwt = new JwtService({ secret });
    const token = (user: typeof owner) =>
      jwt.sign(
        { sub: user.id, role: user.role, email: user.email },
        { expiresIn: '10m' },
      );
    const url = `${await server.getUrl()}/api`;
    const defines = [
      `LISTINGS_TEST_API=${url}`,
      `LISTINGS_TEST_FARMER_ID=${owner.id}`,
      `LISTINGS_TEST_FARMER_TOKEN=${token(owner)}`,
      `LISTINGS_TEST_OTHER_TOKEN=${token(other)}`,
      `LISTINGS_TEST_BUYER_TOKEN=${token(buyer)}`,
    ];
    const exitCode = await new Promise<number>((resolveExit, reject) => {
      const child = spawn(
        process.env.FLUTTER_BIN ?? 'flutter',
        [
          'test',
          'test/listings/live_listings_flow_test.dart',
          '--no-pub',
          ...defines.map((value) => `--dart-define=${value}`),
        ],
        {
          cwd: resolve(__dirname, '../../../farm2fork-mobile'),
          stdio: 'inherit',
        },
      );
      child.on('error', reject);
      child.on('exit', (code) => resolveExit(code ?? 1));
    });
    if (exitCode !== 0) throw new Error(`Mobile E2E failed (${exitCode})`);
    const webExitCode = await new Promise<number>((resolveExit, reject) => {
      const child = spawn(
        'pnpm',
        ['exec', 'vitest', 'run', 'test/live-listings-flow.test.ts'],
        {
          cwd: resolve(__dirname, '../../../farm2fork-web'),
          stdio: 'inherit',
          env: {
            ...process.env,
            LISTINGS_TEST_API: url,
            LISTINGS_TEST_FARMER_TOKEN: token(owner),
            LISTINGS_TEST_BUYER_TOKEN: token(buyer),
          },
        },
      );
      child.on('error', reject);
      child.on('exit', (code) => resolveExit(code ?? 1));
    });
    if (webExitCode !== 0) throw new Error(`Web E2E failed (${webExitCode})`);
    const products = await app
      .get<Model<Product>>(getModelToken(Product.name))
      .find()
      .exec();
    const outbox = await app
      .get<
        Model<BlockchainTransaction>
      >(getModelToken(BlockchainTransaction.name))
      .find()
      .exec();
    if (
      products.length !== 1 ||
      outbox.length !== 1 ||
      products[0].initialBlockchainRecordId?.toString() !==
        outbox[0]._id.toString()
    ) {
      throw new Error(
        'Listing must retain exactly one atomically persisted origin outbox record',
      );
    }
    console.log(
      'PASS: mobile listing -> real JWT/roles -> Nest HTTP -> MongoDB -> mobile/web buyer visibility',
    );
  } finally {
    await server?.close();
    if (!server) await app?.close();
    await mongo.stop();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
