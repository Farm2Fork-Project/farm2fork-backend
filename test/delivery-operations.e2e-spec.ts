import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, createConnection, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DeliveryService } from '../src/modules/delivery/delivery.service';
import {
  DeliveryEarning,
  DeliveryEarningSchema,
  DeliveryPayout,
  DeliveryPayoutSchema,
  ManualRefund,
  ManualRefundSchema,
} from '../src/modules/delivery/schemas/delivery-finance.schema';
import { User, UserSchema } from '../src/modules/auth/schemas/user.schema';
import {
  TransporterProfile,
  TransporterProfileSchema,
} from '../src/modules/auth/schemas/transporter-profile.schema';
import {
  AuditLog,
  AuditLogSchema,
} from '../src/modules/admin/schemas/audit-log.schema';
import { Order, OrderSchema } from '../src/modules/order/schemas/order.schema';
import {
  Payment,
  PaymentSchema,
} from '../src/modules/payment/schemas/payment.schema';
import {
  Shipment,
  ShipmentSchema,
} from '../src/modules/transport/schemas/shipment.schema';
import { TransportService } from '../src/modules/transport/transport.service';
import { SystemConfigService } from '../src/modules/admin/services/system-config.service';
import { NotificationService } from '../src/modules/notification/notification.service';
import { UserRole } from '../src/common/enums/user-role.enum';

jest.setTimeout(60000);
describe('Verified delivery, custody and manual settlement', () => {
  let repl: MongoMemoryReplSet;
  let db: Connection;
  let service: DeliveryService;
  const buyer = {
    id: new Types.ObjectId().toString(),
    email: 'buyer@test.com',
    role: UserRole.Buyer,
  };
  const driver = {
    id: new Types.ObjectId().toString(),
    email: 'driver@test.com',
    role: UserRole.Transporter,
  };
  const admin = {
    id: new Types.ObjectId().toString(),
    email: 'admin@test.com',
    role: UserRole.Admin,
  };
  const farmerId = new Types.ObjectId();
  const transport = {
    toResponse: (ship: { id: string; status: string }) => ({
      id: ship.id,
      status: ship.status,
    }),
    createShipmentSupplyChainEvents: jest.fn().mockResolvedValue(undefined),
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
    const earning = db.model(DeliveryEarning.name, DeliveryEarningSchema),
      payouts = db.model(DeliveryPayout.name, DeliveryPayoutSchema),
      refunds = db.model(ManualRefund.name, ManualRefundSchema);
    service = new DeliveryService(
      db.model(Shipment.name, ShipmentSchema),
      db.model(Order.name, OrderSchema),
      db.model(User.name, UserSchema),
      db.model(TransporterProfile.name, TransporterProfileSchema),
      earning,
      payouts,
      refunds,
      db.model(Payment.name, PaymentSchema),
      db.model(AuditLog.name, AuditLogSchema),
      db,
      new ConfigService({
        JWT_SECRET: 'test-only-secret-with-sufficient-entropy',
      }),
      transport as unknown as TransportService,
      {
        getDeliverySettings: () =>
          Promise.resolve({
            radiusKm: 25,
            locationMaxAgeMinutes: 60,
          }),
      } as unknown as SystemConfigService,
      notifications as unknown as NotificationService,
    );
    await Promise.all(Object.values(db.models).map((model) => model.init()));
  });
  beforeEach(async () => {
    await Promise.all(
      Object.values(db.models).map((model) => model.deleteMany({})),
    );
  });
  afterAll(async () => {
    await db?.close();
    await repl?.stop();
  });
  async function fixture(status = 'in_transit') {
    await db
      .model(User.name)
      .create({ _id: driver.id, email: driver.email, role: driver.role });
    await db.model(TransporterProfile.name).create({
      userId: driver.id,
      vehicleType: 'van',
      vehicleNumber: 'ABC-123',
      cnic: '12345',
      licenseNumber: '45678',
      isAvailable: true,
      lastLocation: { type: 'Point', coordinates: [73.1, 31.43] },
      lastLocationAt: new Date(),
    });
    const order = await db.model(Order.name).create({
      buyerId: buyer.id,
      farmerId,
      items: [],
      totalAmount: 1000,
      platformFeePercent: 5,
      platformFeeAmount: 50,
      grandTotal: 1250,
      deliveryFee: 200,
      status: 'shipped',
      shippingAddress: { city: 'Lahore' },
    });
    const ship = await db.model(Shipment.name).create({
      orderId: order._id,
      transporterId: driver.id,
      status,
      deliveryFee: 200,
      pickupAddress: { lat: 31.42, lng: 73.08 },
      statusHistory: [],
    });
    order.shipmentId = ship._id;
    await order.save();
    return { order, ship };
  }
  it('only the owning buyer can reveal a code; generic shipment documents hide its secret', async () => {
    const { ship } = await fixture();
    await expect(service.code(ship.id, driver)).rejects.toThrow(/buyer/i);
    const code = await service.code(ship.id, buyer);
    expect(code.code).toMatch(/^\d{6}$/);
    expect(
      (await db.model(Shipment.name).findById(ship._id))!.toObject(),
    ).not.toHaveProperty('proofNonce');
  });
  it('caps concurrent incorrect guesses at five persisted attempts', async () => {
    const { ship } = await fixture();
    const proof = await service.code(ship.id, buyer);
    const wrong = proof.code === '000000' ? '111111' : '000000';
    await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        service.complete(ship.id, driver, { code: wrong, note: '' }),
      ),
    );
    const persisted = await db
      .model(Shipment.name)
      .findById(ship._id)
      .select('+proofFailures +proofBlockedUntil');
    expect(persisted!.proofFailures).toBe(5);
    expect(persisted!.proofBlockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(await db.model(DeliveryEarning.name).countDocuments()).toBe(0);
  });
  it('bad codes persist attempt limits, and reissue invalidates previous proof', async () => {
    const { ship } = await fixture();
    const original = await service.code(ship.id, buyer);
    const bad = original.code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt++)
      await expect(
        service.complete(ship.id, driver, { code: bad, note: '' }),
      ).rejects.toThrow();
    await expect(
      service.complete(ship.id, driver, { code: original.code, note: '' }),
    ).rejects.toThrow(/attempt|wait/i);
    const replacement = await service.code(ship.id, buyer, true);
    expect(replacement.code).not.toBe(original.code);
    await expect(
      service.complete(ship.id, driver, { code: original.code, note: '' }),
    ).rejects.toThrow();
    expect(await db.model(DeliveryEarning.name).countDocuments()).toBe(0);
  });
  it('concurrent completion and retries create exactly one earning, then competing payouts allocate it once', async () => {
    const { ship, order } = await fixture();
    const { code } = await service.code(ship.id, buyer);
    await Promise.all([
      service.complete(ship.id, driver, { code, note: '' }),
      service.complete(ship.id, driver, { code, note: '' }),
    ]);
    expect((await db.model(Order.name).findById(order._id))!.status).toBe(
      'delivered',
    );
    expect(await db.model(DeliveryEarning.name).countDocuments()).toBe(1);
    const earnings = await service.earnings(driver.id);
    expect(earnings.totals).toEqual({ earned: 200, unpaid: 200, paid: 0 });
    const input = {
      transporterId: driver.id,
      earningIds: [earnings.items[0].id],
      amount: 200,
      reference: 'BANK-001',
      paidAt: new Date().toISOString(),
      reason: 'Bank transfer completed',
      requestId: randomUUID(),
    };
    const results = await Promise.allSettled([
      service.payout(input, admin),
      service.payout({ ...input, requestId: randomUUID() }, admin),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await service.earnings(driver.id)).totals).toEqual({
      earned: 200,
      unpaid: 0,
      paid: 200,
    });
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    if (winner === 0)
      expect((await service.payout(input, admin)).reference).toBe('BANK-001');
  });
  it('records a clerical payout reversal without deleting the original transfer record', async () => {
    const { ship } = await fixture();
    const { code } = await service.code(ship.id, buyer);
    await service.complete(ship.id, driver, { code, note: '' });
    const earning = (await service.earnings(driver.id)).items[0];
    const payout = await service.payout(
      {
        transporterId: driver.id,
        earningIds: [earning.id],
        amount: 200,
        paidAt: new Date().toISOString(),
        reference: 'WRONG-ENTRY',
        reason: 'Clerical entry for a transfer that did not occur',
        requestId: randomUUID(),
      },
      admin,
    );
    const correction = {
      reason: 'Confirmed no money was transferred; correct the clerical record',
      requestId: randomUUID(),
    };
    await service.reversePayout(payout.id, correction, admin);
    await service.reversePayout(payout.id, correction, admin);
    const ledger = await service.earnings(driver.id);
    expect(ledger.totals).toEqual({ earned: 200, unpaid: 200, paid: 0 });
    expect(ledger.payouts).toHaveLength(2);
    expect(
      ledger.payouts.find((item) => item.id === payout.id)!.reference,
    ).toBe('WRONG-ENTRY');
  });
  it('reassignment preserves history and revokes the previous driver', async () => {
    const { ship } = await fixture('assigned');
    const oldProof = await service.code(ship.id, buyer);
    const nextId = new Types.ObjectId();
    await db
      .model(User.name)
      .create({ _id: nextId, email: 'next@test.com', role: 'transporter' });
    await db.model(TransporterProfile.name).create({
      userId: nextId,
      vehicleType: 'truck',
      vehicleNumber: 'XYZ',
      cnic: '67890',
      licenseNumber: '45678',
      isAvailable: true,
      lastLocation: { type: 'Point', coordinates: [73.1, 31.43] },
      lastLocationAt: new Date(),
    });
    await service.reassign(
      ship.id,
      {
        transporterId: String(nextId),
        reason: 'Original driver cannot reach pickup',
      },
      admin,
    );
    expect(transport.createShipmentSupplyChainEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'shipment_reassigned',
      expect.any(String),
      expect.any(Types.ObjectId),
      expect.any(Date),
      expect.anything(),
      UserRole.Admin,
    );
    const changed = await db.model(Shipment.name).findById(ship._id);
    expect(changed!.assignmentHistory).toHaveLength(1);
    expect(String(changed!.assignmentHistory[0].fromTransporterId)).toBe(
      driver.id,
    );
    expect((await service.code(ship.id, buyer)).code).not.toBe(oldProof.code);
    await expect(
      service.complete(ship.id, driver, { code: oldProof.code, note: '' }),
    ).rejects.toThrow(/assigned/i);
  });
  it('requires resolved custody and full payment evidence before recording a refund', async () => {
    const { ship, order } = await fixture();
    await db.model(Payment.name).create({
      orderId: order._id,
      buyerId: buyer.id,
      amount: 1250,
      gateway: 'safepay',
      status: 'success',
    });
    const transfer = {
      amount: 1250,
      reference: 'REFUND-BANK-001',
      paidAt: new Date().toISOString(),
      reason: 'Goods returned; buyer received full bank refund',
      requestId: randomUUID(),
    };
    await expect(service.refund(order.id, transfer, admin)).rejects.toThrow(
      /resolve|cancel/i,
    );
    await service.issue(ship.id, driver, {
      reason: 'recipient_unavailable',
      note: 'Buyer requested return',
    });
    await service.resolve(
      ship.id,
      {
        resolution: 'return_to_farmer',
        reason: 'Farmer confirmed custody of returned goods',
      },
      admin,
    );
    await expect(
      service.refund(order.id, { ...transfer, amount: 1200 }, admin),
    ).rejects.toThrow(/full/i);
    const record = await service.refund(order.id, transfer, admin);
    expect((await service.refund(order.id, transfer, admin)).id).toBe(
      record.id,
    );
    expect((await service.refundRecord(order.id))!.reference).toBe(
      'REFUND-BANK-001',
    );
    expect(
      (await db.model(Payment.name).findOne({ orderId: order._id }))!.status,
    ).toBe('refunded');
    expect(await db.model(DeliveryEarning.name).countDocuments()).toBe(0);
  });
  it('post-pickup failure requires custody resolution and cannot be reassigned', async () => {
    const { ship } = await fixture();
    await service.issue(ship.id, driver, {
      reason: 'vehicle_issue',
      note: 'Engine failure',
    });
    await expect(
      service.reassign(
        ship.id,
        {
          transporterId: new Types.ObjectId().toString(),
          reason: 'New driver',
        },
        admin,
      ),
    ).rejects.toThrow(/custody|pickup/i);
    await service.resolve(
      ship.id,
      { resolution: 'retry_delivery', reason: 'Vehicle fixed, goods retained' },
      admin,
    );
    expect(transport.createShipmentSupplyChainEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'shipment_issue_resolved',
      expect.any(String),
      expect.any(Types.ObjectId),
      expect.any(Date),
      expect.anything(),
      UserRole.Admin,
    );
    expect((await db.model(Shipment.name).findById(ship._id))!.status).toBe(
      'in_transit',
    );
  });
});
