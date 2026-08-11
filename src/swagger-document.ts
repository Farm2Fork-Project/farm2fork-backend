import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function createSwaggerDocument(
  app: INestApplication,
  port: number,
  apiVersion: string,
): OpenAPIObject {
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
    .addServer('https://api.farm2fork.com', 'Production')
    .addTag('Health', 'Application health check endpoints')
    .addTag(
      'Auth',
      'Registration, login, email verification and password reset',
    )
    .addTag('Marketplace', 'Product listings, search, filtering and QR codes')
    .addTag('Orders', 'Order placement, listing and cancellation')
    .addTag('Payments', 'Payment initiation, gateway callbacks and refunds')
    .addTag(
      'Shipments',
      'Shipment discovery, claims, tracking and delivery updates',
    )
    .build();

  return SwaggerModule.createDocument(app, config);
}
