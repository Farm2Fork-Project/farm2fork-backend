import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import * as Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CsrfGuard } from './common/guards/csrf.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import {
  appConfig,
  blockchainConfig,
  swaggerConfig,
  validationConfig,
} from './config';
import { DatabaseModule, FirebaseModule, RedisModule } from './infrastructure';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { CommunityModule } from './modules/community/community.module';
import { LoanModule } from './modules/loan/loan.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { NotificationModule } from './modules/notification/notification.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
import { TransportModule } from './modules/transport/transport.module';

const shouldLoadInfrastructure = process.env.NODE_ENV !== 'test';

// Feature modules depend on the Mongoose connection, so they load alongside the
// infrastructure modules (skipped under NODE_ENV=test, matching DatabaseModule).
const featureModules = [
  AuthModule,
  MarketplaceModule,
  OrderModule,
  PaymentModule,
  BlockchainModule,
  TransportModule,
  LoanModule,
  AdminModule,
  CommunityModule,
  NotificationModule,
  AiModule,
];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'production', 'test')
          .default('development'),
        PORT: Joi.number().default(3000),
        API_PREFIX: Joi.string().default('api'),
        API_VERSION: Joi.string().default('v1'),
        DATABASE_URL: Joi.string().optional(),
        REDIS_URL: Joi.string().optional(),
        CORS_ORIGIN: Joi.string().optional(),
        JWT_SECRET: Joi.string().optional(),
        JWT_EXPIRATION: Joi.string().default('24h'),
        PAYMENT_SIMULATOR_ENABLED: Joi.boolean().default(false),
        BLOCKCHAIN_WORKER_ENABLED: Joi.boolean().default(false),
        BLOCKCHAIN_POLL_INTERVAL_MS: Joi.number()
          .integer()
          .min(100)
          .default(5_000),
        BLOCKCHAIN_LEASE_DURATION_MS: Joi.number()
          .integer()
          .min(1_000)
          .default(30_000),
        BLOCKCHAIN_RETRY_BASE_DELAY_MS: Joi.number()
          .integer()
          .min(100)
          .default(5_000),
        FABRIC_CHANNEL_NAME: Joi.string().default('farm2forkchannel'),
        FABRIC_CHAINCODE_NAME: Joi.string().default('farm2fork-chaincode'),
        FABRIC_MSP_ID: Joi.string().default('Farm2ForkMSP'),
        FABRIC_PEER_ENDPOINT: Joi.string().default('peer0.farm2fork.com:7051'),
        FABRIC_PEER_HOST_ALIAS: Joi.string().default('peer0.farm2fork.com'),
        FABRIC_TLS_ROOT_CERT_PATH: Joi.string().when(
          'BLOCKCHAIN_WORKER_ENABLED',
          {
            is: true,
            then: Joi.required(),
            otherwise: Joi.optional(),
          },
        ),
        FABRIC_IDENTITY_CERT_PATH: Joi.string().when(
          'BLOCKCHAIN_WORKER_ENABLED',
          {
            is: true,
            then: Joi.required(),
            otherwise: Joi.optional(),
          },
        ),
        FABRIC_IDENTITY_KEY_PATH: Joi.string().when(
          'BLOCKCHAIN_WORKER_ENABLED',
          {
            is: true,
            then: Joi.required(),
            otherwise: Joi.optional(),
          },
        ),
        SWAGGER_ENABLED: Joi.boolean().default(true),
        SWAGGER_PATH: Joi.string().default('api/docs'),
        // Firebase Auth (Google / email-password). The service-account key is a
        // SECRET and must live OUTSIDE the repo (see .env.example).
        FIREBASE_AUTH_ENABLED: Joi.boolean().default(false),
        FIREBASE_PROJECT_ID: Joi.string().optional(),
        FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().optional(),
        FIREBASE_SERVICE_ACCOUNT_PATH: Joi.string().optional(),
        GOOGLE_APPLICATION_CREDENTIALS: Joi.string().optional(),
        // Privileged-role provisioning allowlists (comma-separated emails).
        ADMIN_EMAIL_ALLOWLIST: Joi.string().optional(),
        FINANCIAL_PARTNER_EMAIL_ALLOWLIST: Joi.string().optional(),
        // Firebase web session (HTTP-only cookie) + CSRF/origin protection.
        WEB_APP_ORIGIN: Joi.string().optional(),
        WEB_SESSION_TTL_SECONDS: Joi.number().integer().min(300).default(86_400),
        WEB_SESSION_COOKIE_NAME: Joi.string().default('f2f_session'),
        WEB_SESSION_COOKIE_SECURE: Joi.boolean().default(true),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
      load: [appConfig, blockchainConfig, swaggerConfig, validationConfig],
    }),
    ...(shouldLoadInfrastructure
      ? [DatabaseModule, RedisModule, FirebaseModule, ...featureModules]
      : []),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Guard order matters. CSRF/origin runs first to reject unsafe browser
    // cookie requests, then JWT authenticates (Bearer), then roles authorize.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
