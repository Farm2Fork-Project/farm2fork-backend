import { DeliveryController } from '../delivery/delivery.controller';
import { DeliveryService } from '../delivery/delivery.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('Admin HTTP permissions and validation', () => {
  let app: INestApplication;
  const service = {
    overview: jest.fn().mockResolvedValue({ counts: {} }),
    users: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    setUserStatus: jest.fn(),
    config: jest.fn(),
    saveConfig: jest.fn(),
    audit: jest.fn(),
    user: jest.fn(),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminController, DeliveryController],
      providers: [
        { provide: AdminService, useValue: service },
        {
          provide: DeliveryService,
          useValue: {
            code: jest.fn(),
            complete: jest.fn(),
            issue: jest.fn(),
            earnings: jest.fn(),
            payout: jest.fn(),
            reversePayout: jest.fn(),
            refund: jest.fn(),
            refundRecord: jest.fn(),
            reassign: jest.fn(),
            resolve: jest.fn(),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (
        req: { headers: Record<string, string>; user?: unknown },
        _res: unknown,
        next: () => void,
      ) => {
        if (req.headers['x-test-role'])
          req.user = { id: 'test', role: req.headers['x-test-role'] };
        next();
      },
    );
    app.useGlobalGuards(new RolesGuard(new Reflector()));
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('rejects anonymous and non-admin access across all admin endpoints', async () => {
    for (const path of [
      '/admin/overview',
      '/admin/users',
      '/admin/users/test',
      '/admin/audit-logs',
      '/admin/config',
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer())
        .get(path)
        .set('x-test-role', 'farmer')
        .expect(403);
    }
    await request(app.getHttpServer())
      .patch('/admin/users/test/status')
      .set('x-test-role', 'transporter')
      .send({ isActive: false, reason: 'Attempted change' })
      .expect(403);
    await request(app.getHttpServer())
      .patch('/admin/config')
      .set('x-test-role', 'buyer')
      .send({})
      .expect(403);
  });
  it('protects buyer proof, driver actions and admin settlement routes', async () => {
    await request(app.getHttpServer())
      .get('/delivery/shipments/test/code')
      .expect(401);
    await request(app.getHttpServer())
      .get('/delivery/shipments/test/code')
      .set('x-test-role', 'transporter')
      .expect(403);
    await request(app.getHttpServer())
      .post('/delivery/shipments/test/complete')
      .set('x-test-role', 'buyer')
      .send({ code: '123456' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/delivery/earnings')
      .set('x-test-role', 'buyer')
      .expect(403);
    await request(app.getHttpServer())
      .post('/delivery/admin/payouts')
      .set('x-test-role', 'transporter')
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post('/delivery/admin/orders/test/refund')
      .set('x-test-role', 'buyer')
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .post('/delivery/shipments/test/complete')
      .set('x-test-role', 'transporter')
      .send({ code: 'abc123' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/delivery/admin/payouts')
      .set('x-test-role', 'admin')
      .send({ amount: -1 })
      .expect(400);
  });
  it('validates page bounds and rejects arbitrary mutation fields', async () => {
    await request(app.getHttpServer())
      .get('/admin/users?page=0&limit=1000')
      .set('x-test-role', 'admin')
      .expect(400);
    await request(app.getHttpServer())
      .get('/admin/users?role=superuser')
      .set('x-test-role', 'admin')
      .expect(400);
    await request(app.getHttpServer())
      .patch('/admin/users/test/status')
      .set('x-test-role', 'admin')
      .send({ isActive: false, reason: '   ', role: 'admin' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/admin/users?page=2&limit=10&status=active')
      .set('x-test-role', 'admin')
      .expect(200);
    expect(service.users).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 10, status: 'active' }),
    );
  });
});
