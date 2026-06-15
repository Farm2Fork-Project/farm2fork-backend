import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import {
  ValidationPipe,
  BadRequestException,
  ValidationError,
} from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

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
  const corsOrigin = configService.get<string>('CORS_ORIGIN', '*');

  // Set API prefix
  app.setGlobalPrefix(apiPrefix);

  // Enable CORS
  app.enableCors({
    origin:
      corsOrigin === '*'
        ? true
        : corsOrigin.split(',').map((item) => item.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
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
    const config = new DocumentBuilder()
      .setTitle('Farm2Fork API')
      .setDescription(
        'Farm2Fork API Documentation - Quality produce direct from farms',
      )
      .setVersion(apiVersion)
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter JWT token',
        },
        'JWT-auth',
      )
      .addServer(`http://localhost:${port}`, 'Local Development')
      .addServer(`https://api.farm2fork.com`, 'Production')
      .addTag('Health', 'Application health check endpoints')
      .addTag(
        'Auth',
        'Registration, login, email verification and password reset',
      )
      .addTag('Orders', 'Order placement, listing and cancellation')
      .addTag('Payments', 'Payment initiation, gateway callbacks and refunds')
      .build();

    const document = SwaggerModule.createDocument(app, config);

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
