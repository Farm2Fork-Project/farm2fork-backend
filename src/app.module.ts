import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { appConfig, swaggerConfig, validationConfig } from './config';
import { DatabaseModule, RedisModule } from './infrastructure';

const shouldLoadInfrastructure = process.env.NODE_ENV !== 'test';

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
    ...(shouldLoadInfrastructure ? [DatabaseModule, RedisModule] : []),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
