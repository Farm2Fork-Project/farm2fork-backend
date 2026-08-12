import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { MarketplaceController } from './modules/marketplace/marketplace.controller';
import { MarketplaceService } from './modules/marketplace/marketplace.service';
import { OrderController } from './modules/order/order.controller';
import { OrderService } from './modules/order/order.service';
import { PaymentController } from './modules/payment/payment.controller';
import { PaymentService } from './modules/payment/payment.service';
import { TransportController } from './modules/transport/transport.controller';
import { TransportService } from './modules/transport/transport.service';
import { createSwaggerDocument } from './swagger-document';

type HttpMethod = 'delete' | 'get' | 'post' | 'patch';

describe('createSwaggerDocument', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [
        AppController,
        AuthController,
        MarketplaceController,
        OrderController,
        PaymentController,
        TransportController,
      ],
      providers: [
        { provide: AppService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: MarketplaceService, useValue: {} },
        { provide: OrderService, useValue: {} },
        { provide: PaymentService, useValue: {} },
        { provide: TransportService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents every current public and bearer-protected endpoint', () => {
    const document = createSwaggerDocument(app, 3000, 'v1');

    expect(document.tags?.map((tag) => tag.name)).toEqual(
      expect.arrayContaining([
        'Health',
        'Auth',
        'Marketplace',
        'Orders',
        'Payments',
        'Shipments',
      ]),
    );
    expect(
      document.components?.schemas?.PaymentResponseDto?.properties,
    ).not.toHaveProperty('gatewayRef');

    expectPublic(document, '/api/health', 'get', '200');
    expectPublic(document, '/api/auth/register/farmer', 'post', '201');
    expectPublic(document, '/api/auth/register/buyer', 'post', '201');
    expectPublic(document, '/api/auth/register/transporter', 'post', '201');
    expectPublic(document, '/api/auth/login', 'post', '200');
    expectPublic(document, '/api/auth/verify-email', 'post', '200');
    expectPublic(document, '/api/auth/resend-verification', 'post', '200');
    expectPublic(document, '/api/auth/password-reset/request', 'post', '200');
    expectPublic(document, '/api/auth/password-reset/confirm', 'post', '200');
    expectPublic(document, '/api/auth/firebase', 'post', '200');
    expectPublic(document, '/api/auth/firebase/onboard/farmer', 'post', '201');
    expectPublic(document, '/api/auth/firebase/onboard/buyer', 'post', '201');
    expectPublic(
      document,
      '/api/auth/firebase/onboard/transporter',
      'post',
      '201',
    );
    expectPublicError(
      document,
      '/api/payments/webhook/{gateway}',
      'post',
      '501',
    );

    const protectedRoutes: Array<[string, HttpMethod, string]> = [
      ['/api/auth/me', 'get', '200'],
      ['/api/products', 'post', '201'],
      ['/api/products', 'get', '200'],
      ['/api/products/mine', 'get', '200'],
      ['/api/products/{id}', 'get', '200'],
      ['/api/products/{id}/qr', 'get', '200'],
      ['/api/products/{id}', 'patch', '200'],
      ['/api/products/{id}', 'delete', '200'],
      ['/api/orders', 'post', '201'],
      ['/api/orders', 'get', '200'],
      ['/api/orders/{id}', 'get', '200'],
      ['/api/orders/{id}/cancel', 'patch', '200'],
      ['/api/payments', 'post', '201'],
      ['/api/payments', 'get', '200'],
      ['/api/payments/{id}', 'get', '200'],
      ['/api/payments/{id}/simulate', 'post', '200'],
      ['/api/payments/{id}/refund', 'post', '200'],
      ['/api/shipments/available', 'get', '200'],
      ['/api/shipments/claims', 'post', '201'],
      ['/api/shipments', 'get', '200'],
      ['/api/shipments/{id}', 'get', '200'],
      ['/api/shipments/{id}/status', 'patch', '200'],
    ];

    for (const [path, method, successStatus] of protectedRoutes) {
      expectBearerProtected(document, path, method, successStatus);
    }

    expectError(document, '/api/products/{id}', 'get', '404');
    expectError(document, '/api/products/{id}', 'delete', '404');
    expectError(document, '/api/orders', 'post', '400');
    expectError(document, '/api/orders/{id}', 'get', '404');
    expectError(document, '/api/payments', 'post', '400');
    expectError(document, '/api/payments/{id}', 'get', '404');
    expectError(document, '/api/shipments/claims', 'post', '409');
    expectError(document, '/api/payments/webhook/{gateway}', 'post', '501');
  });
});

function expectPublic(
  document: ReturnType<typeof createSwaggerDocument>,
  path: string,
  method: HttpMethod,
  successStatus: string,
): void {
  const operation = getOperation(document, path, method);
  expect(operation.summary).toEqual(expect.any(String));
  expect(operation.responses).toEqual(
    expect.objectContaining({
      [successStatus]: expect.any(Object),
    }),
  );
  expect(operation.security).toBeUndefined();
}

function expectBearerProtected(
  document: ReturnType<typeof createSwaggerDocument>,
  path: string,
  method: HttpMethod,
  successStatus: string,
): void {
  const operation = getOperation(document, path, method);
  expect(operation.summary).toEqual(expect.any(String));
  expect(operation.responses).toEqual(
    expect.objectContaining({
      [successStatus]: expect.any(Object),
      '401': expect.any(Object),
    }),
  );
  expect(operation.security).toEqual([{ 'JWT-auth': [] }]);
}

function expectPublicError(
  document: ReturnType<typeof createSwaggerDocument>,
  path: string,
  method: HttpMethod,
  errorStatus: string,
): void {
  const operation = getOperation(document, path, method);
  expect(operation.summary).toEqual(expect.any(String));
  expect(operation.responses).toEqual(
    expect.objectContaining({ [errorStatus]: expect.any(Object) }),
  );
  expect(operation.security).toBeUndefined();
}

function expectError(
  document: ReturnType<typeof createSwaggerDocument>,
  path: string,
  method: HttpMethod,
  status: string,
): void {
  expect(getOperation(document, path, method).responses).toEqual(
    expect.objectContaining({ [status]: expect.any(Object) }),
  );
}

function getOperation(
  document: ReturnType<typeof createSwaggerDocument>,
  path: string,
  method: HttpMethod,
) {
  const operation = document.paths[path]?.[method];
  expect(operation).toBeDefined();
  return operation!;
}
