import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import * as Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { appConfig, swaggerConfig, validationConfig } from './config';
import { DatabaseModule, RedisModule } from './infrastructure';
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
        SWAGGER_ENABLED: Joi.boolean().default(true),
        SWAGGER_PATH: Joi.string().default('api/docs'),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
      load: [appConfig, swaggerConfig, validationConfig],
    }),
    ...(shouldLoadInfrastructure
      ? [DatabaseModule, RedisModule, ...featureModules]
      : []),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global authentication then role authorization (master context 9.3).
    // Order matters: JWT runs first to populate request.user, then roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
