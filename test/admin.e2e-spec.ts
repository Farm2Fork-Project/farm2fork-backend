import { BadRequestException } from '@nestjs/common';
import {
  Payment,
  PaymentSchema,
} from '../src/modules/payment/schemas/payment.schema';
import { AdminContentService } from '../src/modules/admin/admin-content.service';
import { Post, PostSchema } from '../src/modules/community/schemas/post.schema';
import {
  Comment,
  CommentSchema,
} from '../src/modules/community/schemas/comment.schema';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, createConnection, Types } from 'mongoose';
import { AdminService } from '../src/modules/admin/admin.service';
import { User, UserSchema } from '../src/modules/auth/schemas/user.schema';
import {
  TransporterProfile,
  TransporterProfileSchema,
} from '../src/modules/auth/schemas/transporter-profile.schema';
import {
  AuditLog,
  AuditLogSchema,
} from '../src/modules/admin/schemas/audit-log.schema';
import {
  SystemConfig,
  SystemConfigSchema,
} from '../src/modules/admin/schemas/system-config.schema';
import { Order, OrderSchema } from '../src/modules/order/schemas/order.schema';
import {
  Product,
  ProductSchema,
} from '../src/modules/marketplace/schemas/product.schema';
import {
  Shipment,
  ShipmentSchema,
} from '../src/modules/transport/schemas/shipment.schema';
import { SystemConfigService } from '../src/modules/admin/services/system-config.service';
import { NotificationService } from '../src/modules/notification/notification.service';
import { UserRole } from '../src/common/enums/user-role.enum';

jest.setTimeout(60000);
describe('Admin operations against a replica set', () => {
  let repl: MongoMemoryReplSet;
  let db: Connection;
  let service: AdminService;
  const actor = {
    id: new Types.ObjectId().toString(),
    role: UserRole.Admin,
    email: 'admin@test.com',
  };
  const notifications = { notifyInBackground: jest.fn() };
  beforeAll(async () => {
    repl = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: {
        downloadDir:
          '/Users/junaid/FYP/farm2fork-backend/node_modules/.cache/mongodb-memory-server',
      },
    });
    db = await createConnection(repl.getUri()).asPromise();
    db.model(Post.name, PostSchema);
    db.model(Comment.name, CommentSchema);
    const users = db.model(User.name, UserSchema);
    const configs = db.model(SystemConfig.name, SystemConfigSchema);
    service = new AdminService(
      users,
      db.model(Product.name, ProductSchema),
      db.model(Order.name, OrderSchema),
      db.model(Shipment.name, ShipmentSchema),
      db.model(TransporterProfile.name, TransporterProfileSchema),
      db.model(AuditLog.name, AuditLogSchema),
      configs,
      db,
      new SystemConfigService(configs),
      notifications as unknown as NotificationService,
      db.model(Payment.name, PaymentSchema),
    );
    await Promise.all(Object.values(db.models).map((model) => model.init()));
  });
  beforeEach(async () => {
    await Promise.all(
      Object.values(db.models).map((model) => model.deleteMany({})),
    );
    notifications.notifyInBackground.mockClear();
  });
  afterAll(async () => {
    await db?.close();
    await repl?.stop();
  });

  it.each(['role', 'action', 'entity'])(
    'rejects operator objects in direct-service %s filters',
    async (field) => {
      const operator = { $ne: null };
      const result =
        field === 'role'
          ? service.users({ role: operator as never })
          : service.audit({ [field]: operator });
      await expect(result).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('paginates literal user searches and never returns credentials or device identifiers', async () => {
    await db.model(User.name).create([
      {
        email: 'farmer+one@test.com',
        role: 'farmer',
        fullName: 'Literal [name]',
        firebaseUid: 'secret',
        fcmToken: 'secret',
      },
      { email: 'buyer@test.com', role: 'buyer' },
    ]);
    const result = await service.users({ search: '[name]', page: 1, limit: 1 });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/firebaseUid|fcmToken|secret/);
  });

  it('blocks administrator deactivation and deactivation with unresolved deliveries', async () => {
    const admin = await db
      .model(User.name)
      .create({ email: 'another@test.com', role: 'admin' });
    await expect(
      service.setUserStatus(
        admin.id,
        { isActive: false, reason: 'Review requested' },
        actor,
      ),
    ).rejects.toThrow(/administrator/i);
    const driver = await db
      .model(User.name)
      .create({ email: 'driver@test.com', role: 'transporter' });
    await db.model(TransporterProfile.name).create({
      userId: driver._id,
      cnic: '123',
      licenseNumber: '456',
      vehicleType: 'van',
      vehicleNumber: 'ABC',
    });
    await db.model(Shipment.name).create({
      orderId: new Types.ObjectId(),
      transporterId: driver._id,
      status: 'picked_up',
    });
    await expect(
      service.setUserStatus(
        driver.id,
        { isActive: false, reason: 'Review requested' },
        actor,
      ),
    ).rejects.toThrow(/delivery/i);
    expect((await db.model(User.name).findById(driver._id))!.isActive).toBe(
      true,
    );
    expect(await db.model(AuditLog.name).countDocuments()).toBe(0);
  });

  it('suspends idle driver dispatch and records one audit entry for a retried status request', async () => {
    const driver = await db
      .model(User.name)
      .create({ email: 'driver@test.com', role: 'transporter' });
    await db.model(TransporterProfile.name).create({
      userId: driver._id,
      cnic: '123',
      licenseNumber: '456',
      vehicleType: 'van',
      vehicleNumber: 'ABC',
    });
    const input = { isActive: false, reason: 'Reported account misuse' };
    await service.setUserStatus(driver.id, input, actor);
    await service.setUserStatus(driver.id, input, actor);
    const profile = await db
      .model(TransporterProfile.name)
      .findOne({ userId: driver._id });
    expect(profile!.isAvailable).toBe(false);
    expect(profile!.dispatchSuspended).toBe(true);
    expect(
      await db
        .model(AuditLog.name)
        .countDocuments({ action: 'user.deactivated' }),
    ).toBe(1);
    expect(notifications.notifyInBackground).toHaveBeenCalledTimes(1);
  });

  it('links the operational count to a filtered unresolved-delivery queue', async () => {
    const actorId = new Types.ObjectId(actor.id);
    for (const resolved of [false, true]) {
      const ship = await db.model(Shipment.name).create({
        orderId: new Types.ObjectId(),
        transporterId: actorId,
        status: 'failed',
        issue: {
          reason: 'vehicle_issue',
          stage: 'in_transit',
          reportedAt: new Date(),
          ...(resolved
            ? { resolvedAt: new Date(), resolution: 'return_to_farmer' }
            : {}),
        },
      });
      await db.model(Order.name).create({
        _id: ship.orderId,
        buyerId: actorId,
        farmerId: actorId,
        shipmentId: ship._id,
        status: resolved ? 'cancelled' : 'shipped',
        items: [],
        totalAmount: 100,
        platformFeePercent: 5,
        platformFeeAmount: 5,
        deliveryFee: 20,
        grandTotal: 125,
        shippingAddress: { city: 'Lahore' },
      });
    }
    expect((await service.overview()).counts.failedShipments).toBe(1);
    const content = new AdminContentService(
      db.model(Product.name),
      db.model(Order.name),
      db.model(Post.name),
      db.model(Comment.name),
      db.model(AuditLog.name),
      db,
    );
    const queue = await content.orders({
      page: 1,
      limit: 20,
      deliveryIssue: 'unresolved',
    });
    expect(queue.total).toBe(1);
    expect(queue.items[0].status).toBe('shipped');
  });
  it('validates related config bounds and rejects a stale concurrent save', async () => {
    const initial = await service.config();
    const values = Object.fromEntries(
      initial.items.map((item) => [item.key, item.effectiveValue]),
    );
    await expect(
      service.saveConfig(
        {
          values: { ...values, min_loan_amount: 2000000 },
          revision: initial.revision,
          reason: 'Update limits',
        },
        actor,
      ),
    ).rejects.toThrow(/minimum/i);
    const saves = await Promise.allSettled([
      service.saveConfig(
        {
          values: { ...values, platform_fee_percent: 6 },
          revision: initial.revision,
          reason: 'Change fees',
        },
        actor,
      ),
      service.saveConfig(
        {
          values: { ...values, platform_fee_percent: 7 },
          revision: initial.revision,
          reason: 'Change fees',
        },
        actor,
      ),
    ]);
    expect(
      saves.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await service.config()).revision).toBe(1);
    expect(
      await db
        .model(AuditLog.name)
        .countDocuments({ action: 'config.updated' }),
    ).toBe(1);
  });

  it('redacts legacy audit metadata instead of leaking arbitrary before/after objects', async () => {
    await db.model(AuditLog.name).create({
      actorId: actor.id,
      actorRole: 'admin',
      action: 'user.updated',
      targetEntity: 'User',
      metadata: {
        before: {
          fullName: 'Public',
          cnic: 'secret',
          nested: { fcmToken: 'secret' },
        },
        after: { isActive: false, reason: 'Reviewed' },
      },
    });
    const page = await service.audit({ page: 1, limit: 20 });
    expect(JSON.stringify(page)).not.toMatch(/secret|cnic|fcmToken/);
    expect(page.items[0].metadata.after).toEqual({
      isActive: false,
      reason: 'Reviewed',
    });
  });
});
