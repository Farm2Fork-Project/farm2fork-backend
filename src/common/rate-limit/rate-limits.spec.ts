import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { TraceabilityController } from '../../modules/traceability/traceability.controller';
import { TraceabilityService } from '../../modules/traceability/traceability.service';

describe('rate limits', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        }),
      ],
      controllers: [TraceabilityController],
      providers: [
        {
          provide: TraceabilityService,
          useValue: { traceProduct: jest.fn().mockResolvedValue({}) },
        },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('caps the public trace endpoint at 60 requests per minute per client', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 60; i += 1) {
      await request(server).get('/trace/products/abc').expect(200);
    }
    const limited = await request(server).get('/trace/products/abc');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
});
