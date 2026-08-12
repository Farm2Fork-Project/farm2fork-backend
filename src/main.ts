import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  ValidationPipe,
  BadRequestException,
  ValidationError,
} from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { createSwaggerDocument } from './swagger-document';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Get configuration values
  const port = configService.get<number>('PORT', 3000);
  const apiPrefix = configService.get<string>('API_PREFIX', 'api');
  const apiVersion = configService.get<string>('API_VERSION', 'v1');
  const swaggerEnabled = configService.get<boolean>('SWAGGER_ENABLED', true);
  const swaggerPath = configService.get<string>('SWAGGER_PATH', 'api/docs');
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const corsOrigin = configService.get<string>('CORS_ORIGIN', '');

  // Set API prefix
  app.setGlobalPrefix(apiPrefix);

  // Parse cookies so the Firebase web session cookie is available to guards.
  app.use(cookieParser());

  // Credentialed CORS is required for the HTTP-only web session cookie, and a
  // wildcard origin is invalid when credentials are enabled. Fail fast on '*'.
  const allowedOrigins = corsOrigin
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    throw new Error(
      'CORS_ORIGIN must be an explicit comma-separated origin list (not "*") ' +
        'because credentialed web sessions are enabled.',
    );
  }
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Farm2Fork-CSRF'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (errors: ValidationError[]) => {
        const messages = errors
          .map((error) => {
            const constraints = Object.values(error.constraints || {});
            return `${error.property}: ${constraints.join(', ')}`;
          })
          .join('; ');
        return new BadRequestException({
          success: false,
          message: 'Validation failed',
          error: messages,
          timestamp: new Date().toISOString(),
        });
      },
    }),
  );

  // Swagger setup
  if (swaggerEnabled) {
    const document = createSwaggerDocument(app, port, apiVersion);

    SwaggerModule.setup(swaggerPath, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayOperationId: true,
        operationsSorter: 'method',
        tagsSorter: 'alpha',
      },

      customSiteTitle: 'Farm2Fork API Docs',
    });
    console.log(
      `📚 Swagger documentation available at http://localhost:${port}/${swaggerPath}`,
    );
  }

  await app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${port}`);
    console.log(`📡 Environment: ${nodeEnv}`);
    console.log(`🔗 API Prefix: /${apiPrefix}`);
  });
}

bootstrap().catch((err: unknown) => {
  console.error(err);
});
