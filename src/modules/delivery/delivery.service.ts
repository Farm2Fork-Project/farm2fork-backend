import { activeDeliveryFilter } from '../transport/active-delivery';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { User, UserDocument } from '../auth/schemas/user.schema';
import {
  TransporterProfile,
  TransporterProfileDocument,
} from '../auth/schemas/transporter-profile.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../order/schemas/order.schema';
import {
  Payment,
  PaymentDocument,
  PaymentStatus,
} from '../payment/schemas/payment.schema';
import {
  Shipment,
  ShipmentDocument,
  ShipmentStatus,
} from '../transport/schemas/shipment.schema';
import { TransportService } from '../transport/transport.service';
import { SystemConfigService } from '../admin/services/system-config.service';
import { AuditLog, AuditLogDocument } from '../admin/schemas/audit-log.schema';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import { RequestUser } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import { haversineKm, fromGeoPoint } from '../../common/geo/geo';
import {
  DeliveryEarning,
  DeliveryEarningDocument,
  DeliveryPayout,
  DeliveryPayoutDocument,
  ManualRefund,
  ManualRefundDocument,
} from './schemas/delivery-finance.schema';
import {
  CompleteDeliveryDto,
  DeliveryIssueDto,
  PayoutCorrectionDto,
  ManualTransferDto,
  ReassignDeliveryDto,
  RecordPayoutDto,
  ResolveDeliveryDto,
} from './delivery.dto';

const ACTIVE = [
  ShipmentStatus.Assigned,
  ShipmentStatus.PickedUp,
  ShipmentStatus.InTransit,
];
function id(value: string) {
  if (!Types.ObjectId.isValid(value))
    throw new NotFoundException('Record not found');
  return new Types.ObjectId(value);
}
function minor(value: number) {
  const result = Math.round(value * 100);
  if (
    !Number.isSafeInteger(result) ||
    result < 0 ||
    Math.abs(result / 100 - value) > 0.000001
  )
    throw new BadRequestException(
      'Amount must be a valid PKR amount with at most two decimal places',
    );
  return result;
}
function fingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function transferDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 60000)
    throw new BadRequestException('Payment date must not be in the future');
  return date;
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);
  constructor(
    @InjectModel(Shipment.name) private readonly ships: Model<ShipmentDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(TransporterProfile.name)
    private readonly drivers: Model<TransporterProfileDocument>,
    @InjectModel(DeliveryEarning.name)
    private readonly ledger: Model<DeliveryEarningDocument>,
    @InjectModel(DeliveryPayout.name)
    private readonly payouts: Model<DeliveryPayoutDocument>,
    @InjectModel(ManualRefund.name)
    private readonly refunds: Model<ManualRefundDocument>,
    @InjectModel(Payment.name)
    private readonly payments: Model<PaymentDocument>,
    @InjectModel(AuditLog.name)
    private readonly audits: Model<AuditLogDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly transport: TransportService,
    private readonly settings: SystemConfigService,
    private readonly notifications: NotificationService,
  ) {}
  private secret() {
    const secret =
      this.config.get<string>('DELIVERY_CODE_SECRET') ||
      this.config.get<string>('JWT_SECRET');
    if (!secret || secret.length < 16)
      throw new ServiceUnavailableException(
        'Delivery confirmation is not configured. Contact the platform administrator.',
      );
    return secret;
  }
  private proof(ship: ShipmentDocument, nonce = ship.proofNonce!) {
    return (
      createHmac('sha256', this.secret())
        .update(
          `delivery:${String(ship._id)}:${String(ship.transporterId)}:${nonce}`,
        )
        .digest()
        .readUInt32BE(0) % 1000000
    )
      .toString()
      .padStart(6, '0');
  }
  private sameCode(ship: ShipmentDocument, code: string) {
    return (
      /^\d{6}$/.test(code) &&
      Boolean(ship.proofNonce) &&
      timingSafeEqual(Buffer.from(this.proof(ship)), Buffer.from(code))
    );
  }
  private async load(shipId: string) {
    const ship = await this.ships
      .findById(id(shipId))
      .select('+proofNonce +proofFailures +proofBlockedUntil');
    if (!ship) throw new NotFoundException('Shipment not found');
    return ship;
  }
  private async audit(
    action: string,
    targetEntity: string,
    target: Types.ObjectId,
    actor: RequestUser,
    reason: string,
    session: ClientSession,
  ) {
    await this.audits.create(
      [
        {
          actorId: id(actor.id),
          actorRole: actor.role,
          action,
          targetEntity,
          targetId: target,
          metadata: { after: { reason } },
        },
      ],
      { session },
    );
  }
  private notify(
    ship: ShipmentDocument,
    order: OrderDocument,
    title: string,
    message: string,
  ) {
    this.notifications.notifyInBackground({
      userIds: [
        order.buyerId,
        order.farmerId,
        ...(ship.transporterId ? [ship.transporterId] : []),
      ],
      type: NotificationType.DeliveryUpdate,
      title,
      message,
      relatedEntityId: ship._id,
      relatedEntityModel: 'Shipment',
    });
  }

  async code(shipId: string, buyer: RequestUser, reissue = false) {
    const ship = await this.load(shipId);
    const order = await this.orders.findById(ship.orderId);
    if (buyer.role !== UserRole.Buyer || String(order?.buyerId) !== buyer.id)
      throw new ForbiddenException(
        'Only the buyer for this order can view its delivery code',
      );
    if (!ACTIVE.includes(ship.status))
      throw new ConflictException(
        'A delivery code is available only during an active delivery',
      );
    this.secret();
    if (!ship.proofNonce || reissue) {
      let nonce = randomBytes(24).toString('hex');
      if (ship.proofNonce)
        while (this.proof(ship, nonce) === this.proof(ship))
          nonce = randomBytes(24).toString('hex');
      const expectedNonce = ship.proofNonce;
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(async () => {
          const updated = await this.ships
            .findOneAndUpdate(
              {
                _id: ship._id,
                transporterId: ship.transporterId,
                status: { $in: ACTIVE },
                proofNonce: expectedNonce ?? { $exists: false },
              },
              {
                $set: { proofNonce: nonce, proofFailures: 0 },
                $unset: { proofBlockedUntil: 1 },
              },
              { new: true, session },
            )
            .select('+proofNonce');
          if (!updated)
            throw new ConflictException(
              'Delivery changed. Reload before requesting its code.',
            );
          if (reissue)
            await this.audit(
              'delivery.code_reissued',
              'Shipment',
              ship._id,
              buyer,
              'Buyer requested a replacement delivery code',
              session,
            );
        });
      } finally {
        await session.endSession();
      }
      ship.proofNonce = nonce;
    }
    return { shipmentId: String(ship._id), code: this.proof(ship) };
  }

  async complete(
    shipId: string,
    driver: RequestUser,
    dto: CompleteDeliveryDto,
  ) {
    const session = await this.connection.startSession();
    let result!: ShipmentDocument;
    let order!: OrderDocument;
    let changed = false;
    let incorrect = false;
    let locked = false;
    try {
      await session.withTransaction(async () => {
        changed = false;
        incorrect = false;
        locked = false;
        const ship = await this.ships
          .findById(id(shipId))
          .select('+proofNonce +proofFailures +proofBlockedUntil')
          .session(session);
        if (!ship) throw new NotFoundException('Shipment not found');
        if (String(ship.transporterId) !== driver.id)
          throw new ForbiddenException('This delivery is not assigned to you');
        if (ship.status === ShipmentStatus.Delivered) {
          if (!this.sameCode(ship, dto.code))
            throw new BadRequestException('The delivery code is incorrect');
          result = ship;
          return;
        }
        if (ship.status !== ShipmentStatus.InTransit)
          throw new ConflictException(
            'Confirm pickup and start the delivery before completing it',
          );
        const now = new Date();
        if (ship.proofBlockedUntil && ship.proofBlockedUntil > now) {
          locked = true;
          return;
        }
        if (ship.proofBlockedUntil) {
          ship.proofFailures = 0;
          ship.proofBlockedUntil = undefined;
        }
        if (!this.sameCode(ship, dto.code)) {
          ship.proofFailures = (ship.proofFailures ?? 0) + 1;
          if (ship.proofFailures >= 5)
            ship.proofBlockedUntil = new Date(now.getTime() + 15 * 60000);
          await ship.save({ session });
          incorrect = true;
          return;
        }
        const found = await this.orders.findById(ship.orderId).session(session);
        if (!found) throw new NotFoundException('Order not found');
        order = found;
        ship.status = ShipmentStatus.Delivered;
        ship.actualDelivery = now;
        ship.statusHistory.push({
          status: ShipmentStatus.Delivered,
          timestamp: now,
          note: dto.note || 'Buyer delivery code verified',
          updatedBy: id(driver.id),
        });
        order.status = OrderStatus.Delivered;
        await this.ledger.create(
          [
            {
              shipmentId: ship._id,
              orderId: order._id,
              transporterId: ship.transporterId,
              amountMinor: minor(ship.deliveryFee ?? order.deliveryFee),
              earnedAt: now,
            },
          ],
          { session },
        );
        await this.transport.createShipmentSupplyChainEvents(
          order,
          ship,
          'shipment_delivered',
          [ship.deliveryAddress?.city, ship.deliveryAddress?.province]
            .filter(Boolean)
            .join(', '),
          id(driver.id),
          now,
          session,
        );
        await ship.save({ session });
        await order.save({ session });
        await this.audit(
          'delivery.verified',
          'Shipment',
          ship._id,
          driver,
          'Buyer code verified at handover',
          session,
        );
        changed = true;
        result = ship;
      });
    } finally {
      await session.endSession();
    }
    if (locked)
      throw new HttpException(
        'Too many code attempts. Wait 15 minutes or ask the buyer to reissue their code.',
        429,
      );
    if (incorrect)
      throw new BadRequestException(
        'The delivery code is incorrect. Ask the buyer to check the current code.',
      );
    if (changed)
      this.notify(
        result,
        order,
        'Delivery completed',
        'The buyer delivery code was verified. The delivery is complete.',
      );
    return this.transport.toResponse(result);
  }

  async issue(shipId: string, driver: RequestUser, dto: DeliveryIssueDto) {
    const session = await this.connection.startSession();
    let result!: ShipmentDocument;
    let order!: OrderDocument;
    try {
      await session.withTransaction(async () => {
        const ship = await this.ships.findById(id(shipId)).session(session);
        if (!ship) throw new NotFoundException('Shipment not found');
        if (String(ship.transporterId) !== driver.id)
          throw new ForbiddenException('This delivery is not assigned to you');
        if (!ACTIVE.includes(ship.status))
          throw new ConflictException(
            'This delivery already changed. Reload its status.',
          );
        const found = await this.orders.findById(ship.orderId).session(session);
        if (!found) throw new NotFoundException('Order not found');
        order = found;
        const now = new Date();
        ship.issue = {
          reason: dto.reason,
          note: dto.note,
          stage: ship.status,
          reportedAt: now,
        };
        ship.status = ShipmentStatus.Failed;
        ship.statusHistory.push({
          status: ShipmentStatus.Failed,
          timestamp: now,
          note: `${dto.reason}: ${dto.note}`,
          updatedBy: id(driver.id),
        });
        await ship.save({ session });
        await this.transport.createShipmentSupplyChainEvents(
          order,
          ship,
          'shipment_issue_reported',
          [ship.pickupAddress?.city, ship.deliveryAddress?.city]
            .filter(Boolean)
            .join(' → '),
          id(driver.id),
          now,
          session,
          driver.role,
        );
        await this.audit(
          'delivery.issue_reported',
          'Shipment',
          ship._id,
          driver,
          `${dto.reason}: ${dto.note}`,
          session,
        );
        result = ship;
      });
    } finally {
      await session.endSession();
    }
    this.notify(
      result,
      order,
      'Delivery needs attention',
      'A delivery issue was reported. An administrator must resolve the delivery before it can continue.',
    );
    void this.users
      .find({ role: UserRole.Admin, isActive: true })
      .select('_id')
      .lean()
      .exec()
      .then((admins) =>
        this.notifications.notifyInBackground({
          userIds: admins.map((admin) => admin._id),
          type: NotificationType.DeliveryUpdate,
          title: 'Delivery needs an operations decision',
          message:
            'A transporter reported a delivery issue. Review custody and resolve the shipment.',
          relatedEntityId: result._id,
          relatedEntityModel: 'Shipment',
        }),
      )
      .catch(() =>
        this.logger.warn(
          'Could not notify operations about the delivery issue',
        ),
      );
    return this.transport.toResponse(result);
  }

  async reassign(shipId: string, dto: ReassignDeliveryDto, actor: RequestUser) {
    const settings = await this.settings.getDeliverySettings();
    const session = await this.connection.startSession();
    let result!: ShipmentDocument;
    let order!: OrderDocument;
    try {
      await session.withTransaction(async () => {
        const ship = await this.ships
          .findById(id(shipId))
          .select('+proofNonce')
          .session(session);
        if (!ship) throw new NotFoundException('Shipment not found');
        if (
          !(
            ship.status === ShipmentStatus.Assigned ||
            (ship.status === ShipmentStatus.Failed &&
              ship.issue?.stage === ShipmentStatus.Assigned &&
              !ship.issue.resolvedAt)
          )
        )
          throw new ConflictException(
            'Goods may be in driver custody. Resolve the pickup or delivery issue before reassignment.',
          );
        if (String(ship.transporterId) === dto.transporterId)
          throw new BadRequestException('Choose a different transporter');
        const account = await this.users
          .findOne({
            _id: id(dto.transporterId),
            role: UserRole.Transporter,
            isActive: true,
          })
          .session(session);
        if (!account)
          throw new BadRequestException('Choose an active transporter');
        if (ship.transporterId)
          await this.drivers.updateOne(
            { userId: ship.transporterId },
            { $set: { lastClaimAt: new Date() } },
            { session },
          );
        const profile = await this.drivers.findOneAndUpdate(
          { userId: account._id },
          { $set: { lastClaimAt: new Date() } },
          { new: true, session },
        );
        if (
          !profile?.isAvailable ||
          profile.dispatchSuspended ||
          !profile.lastLocation ||
          !profile.lastLocationAt ||
          profile.lastLocationAt.getTime() <
            Date.now() - settings.locationMaxAgeMinutes * 60000
        )
          throw new ConflictException(
            'Transporter must be online with a current location',
          );
        const another = await this.ships
          .exists({
            transporterId: account._id,
            _id: { $ne: ship._id },
            ...activeDeliveryFilter(),
          })
          .session(session);
        if (another)
          throw new ConflictException(
            'Transporter already has an active delivery',
          );
        const pickup = ship.pickupAddress;
        if (
          pickup?.lat == null ||
          pickup.lng == null ||
          haversineKm(fromGeoPoint(profile.lastLocation), {
            lat: pickup.lat,
            lng: pickup.lng,
          }) > settings.radiusKm
        )
          throw new ConflictException(
            'Transporter is outside the pickup radius',
          );
        const found = await this.orders.findById(ship.orderId).session(session);
        if (!found) throw new NotFoundException('Order not found');
        order = found;
        const now = new Date();
        ship.assignmentHistory.push({
          fromTransporterId: ship.transporterId,
          transporterId: account._id,
          assignedBy: id(actor.id),
          reason: dto.reason,
          timestamp: now,
        });
        const previousCode = ship.proofNonce ? this.proof(ship) : undefined;
        ship.transporterId = account._id;
        ship.status = ShipmentStatus.Assigned;
        ship.issue = undefined;
        ship.proofNonce = randomBytes(24).toString('hex');
        ship.proofFailures = 0;
        ship.proofBlockedUntil = undefined;
        while (previousCode && this.proof(ship) === previousCode)
          ship.proofNonce = randomBytes(24).toString('hex');
        ship.statusHistory.push({
          status: ShipmentStatus.Assigned,
          timestamp: now,
          note: `Reassigned: ${dto.reason}`,
          updatedBy: id(actor.id),
        });
        order.status = OrderStatus.Processing;
        await ship.save({ session });
        await order.save({ session });
        await this.transport.createShipmentSupplyChainEvents(
          order,
          ship,
          'shipment_reassigned',
          [ship.pickupAddress?.city, ship.deliveryAddress?.city]
            .filter(Boolean)
            .join(' → '),
          id(actor.id),
          now,
          session,
          actor.role,
        );
        await this.audit(
          'delivery.reassigned',
          'Shipment',
          ship._id,
          actor,
          dto.reason,
          session,
        );
        result = ship;
      });
    } finally {
      await session.endSession();
    }
    this.notify(
      result,
      order,
      'Delivery reassigned',
      'An administrator assigned another transporter. Check the updated delivery timeline.',
    );
    const old = result.assignmentHistory.at(-1)?.fromTransporterId;
    if (old)
      this.notifications.notifyInBackground({
        userIds: [old],
        type: NotificationType.DeliveryUpdate,
        title: 'Delivery reassigned',
        message: 'This delivery has been assigned to another transporter.',
        relatedEntityId: result._id,
        relatedEntityModel: 'Shipment',
      });
    return this.transport.toResponse(result);
  }

  async resolve(shipId: string, dto: ResolveDeliveryDto, actor: RequestUser) {
    const session = await this.connection.startSession();
    let result!: ShipmentDocument;
    let order!: OrderDocument;
    try {
      await session.withTransaction(async () => {
        const ship = await this.ships.findById(id(shipId)).session(session);
        if (!ship) throw new NotFoundException('Shipment not found');
        if (
          ship.status === ShipmentStatus.Failed &&
          !ship.issue &&
          dto.resolution === 'return_to_farmer'
        )
          ship.issue = {
            reason: 'legacy_delivery_issue',
            stage: ShipmentStatus.InTransit,
            reportedAt: ship.updatedAt,
          };
        if (
          ship.status !== ShipmentStatus.Failed ||
          !ship.issue ||
          ship.issue.resolvedAt
        )
          throw new ConflictException('No unresolved delivery issue remains');
        const found = await this.orders.findById(ship.orderId).session(session);
        if (!found) throw new NotFoundException('Order not found');
        order = found;
        const now = new Date();
        if (dto.resolution === 'retry_delivery') {
          const driver = await this.drivers.findOneAndUpdate(
            { userId: ship.transporterId },
            { $set: { lastClaimAt: now } },
            { new: true, session },
          );
          const active = await this.ships
            .exists({
              transporterId: ship.transporterId,
              _id: { $ne: ship._id },
              ...activeDeliveryFilter(),
            })
            .session(session);
          const account = await this.users
            .findOne({ _id: ship.transporterId, isActive: true })
            .session(session);
          if (!driver || active || !account)
            throw new ConflictException(
              'The original transporter cannot resume this delivery',
            );
          ship.status =
            ship.issue.stage === ShipmentStatus.Assigned
              ? ShipmentStatus.Assigned
              : ShipmentStatus.InTransit;
          order.status =
            ship.status === ShipmentStatus.Assigned
              ? OrderStatus.Processing
              : OrderStatus.Shipped;
        } else {
          order.status = OrderStatus.Cancelled;
        }
        ship.issue.resolvedAt = now;
        ship.issue.resolution = dto.resolution;
        ship.statusHistory.push({
          status: ship.status,
          timestamp: now,
          note: `${dto.resolution}: ${dto.reason}`,
          updatedBy: id(actor.id),
        });
        await ship.save({ session });
        await order.save({ session });
        await this.transport.createShipmentSupplyChainEvents(
          order,
          ship,
          'shipment_issue_resolved',
          [ship.pickupAddress?.city, ship.deliveryAddress?.city]
            .filter(Boolean)
            .join(' → '),
          id(actor.id),
          now,
          session,
          actor.role,
        );
        await this.audit(
          'delivery.issue_resolved',
          'Shipment',
          ship._id,
          actor,
          dto.reason,
          session,
        );
        result = ship;
      });
    } finally {
      await session.endSession();
    }
    this.notify(
      result,
      order,
      'Delivery issue resolved',
      dto.resolution === 'retry_delivery'
        ? 'The assigned transporter will continue the delivery.'
        : 'The administrator confirmed return to the farmer. Any payment refund is handled separately.',
    );
    return this.transport.toResponse(result);
  }

  async earnings(transporterId?: string) {
    const filter = transporterId ? { transporterId: id(transporterId) } : {};
    const [entries, payouts] = await Promise.all([
      this.ledger.find(filter).sort({ earnedAt: -1 }).lean(),
      this.payouts.find(filter).sort({ createdAt: -1 }).lean(),
    ]);
    const earned = entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
    const paid = entries.reduce(
      (sum, entry) => sum + (entry.payoutId ? entry.amountMinor : 0),
      0,
    );
    return {
      totals: {
        earned: earned / 100,
        unpaid: (earned - paid) / 100,
        paid: paid / 100,
      },
      items: entries.map((entry) => ({
        id: String(entry._id),
        shipmentId: String(entry.shipmentId),
        orderId: String(entry.orderId),
        transporterId: String(entry.transporterId),
        amount: entry.amountMinor / 100,
        status: entry.payoutId ? 'paid' : 'unpaid',
        earnedAt: entry.earnedAt,
        payoutId: entry.payoutId ? String(entry.payoutId) : undefined,
      })),
      payouts: payouts.map((entry) => this.payoutResponse(entry)),
    };
  }
  private payoutResponse(entry: {
    _id: Types.ObjectId;
    transporterId: Types.ObjectId;
    amountMinor: number;
    paidAt: Date;
    reference: string;
    createdAt: Date;
    earningIds: Types.ObjectId[];
    reversesPayoutId?: Types.ObjectId;
  }) {
    return {
      id: String(entry._id),
      transporterId: String(entry.transporterId),
      amount: entry.amountMinor / 100,
      paidAt: entry.paidAt,
      reference: entry.reference,
      createdAt: entry.createdAt,
      earningIds: entry.earningIds.map(String),
      reversesPayoutId: entry.reversesPayoutId
        ? String(entry.reversesPayoutId)
        : undefined,
    };
  }
  async payout(dto: RecordPayoutDto, actor: RequestUser) {
    const paidAt = transferDate(dto.paidAt);
    const amountMinor = minor(dto.amount);
    const earningIds = [...dto.earningIds].sort();
    const hash = fingerprint([
      dto.transporterId,
      earningIds,
      amountMinor,
      paidAt.toISOString(),
      dto.reference,
      dto.reason,
    ]);
    const existing = await this.payouts
      .findOne({ requestId: dto.requestId })
      .select('+fingerprint');
    if (existing) {
      if (existing.fingerprint !== hash)
        throw new ConflictException(
          'This payout request was already used with different details',
        );
      return this.payoutResponse(existing);
    }
    const session = await this.connection.startSession();
    let result!: DeliveryPayoutDocument;
    try {
      await session.withTransaction(async () => {
        const entries = await this.ledger
          .find({
            _id: { $in: earningIds.map(id) },
            transporterId: id(dto.transporterId),
            payoutId: { $exists: false },
          })
          .session(session);
        if (
          entries.length !== earningIds.length ||
          entries.reduce((sum, item) => sum + item.amountMinor, 0) !==
            amountMinor
        )
          throw new ConflictException(
            'Earnings changed or the payout amount does not match the selected unpaid deliveries',
          );
        const [record] = await this.payouts.create(
          [
            {
              requestId: dto.requestId,
              fingerprint: hash,
              transporterId: id(dto.transporterId),
              earningIds: earningIds.map(id),
              amountMinor,
              paidAt,
              reference: dto.reference,
              reason: dto.reason,
              recordedBy: id(actor.id),
            },
          ],
          { session },
        );
        const allocation = await this.ledger.updateMany(
          { _id: { $in: earningIds.map(id) }, payoutId: { $exists: false } },
          { $set: { payoutId: record._id } },
          { session },
        );
        if (allocation.modifiedCount !== earningIds.length)
          throw new ConflictException(
            'Some deliveries were already paid. Reload unpaid earnings.',
          );
        await this.audit(
          'payout.recorded',
          'DeliveryPayout',
          record._id,
          actor,
          dto.reason,
          session,
        );
        result = record;
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const prior = await this.payouts
          .findOne({ requestId: dto.requestId })
          .select('+fingerprint');
        if (prior?.fingerprint === hash) return this.payoutResponse(prior);
        throw new ConflictException('Payout request already exists');
      }
      throw error;
    } finally {
      await session.endSession();
    }
    this.notifications.notifyInBackground({
      userIds: [dto.transporterId],
      type: NotificationType.PayoutRecorded,
      title: 'Delivery payout recorded',
      message: `An administrator recorded a manual payout of PKR ${dto.amount}. Reference: ${dto.reference}.`,
    });
    return this.payoutResponse(result);
  }
  async reversePayout(
    payoutId: string,
    dto: PayoutCorrectionDto,
    actor: RequestUser,
  ) {
    const hash = fingerprint([payoutId, dto.reason]);
    const previous = await this.payouts
      .findOne({ reversesPayoutId: id(payoutId) })
      .select('+fingerprint');
    if (previous) {
      if (previous.requestId !== dto.requestId || previous.fingerprint !== hash)
        throw new ConflictException(
          'This payout already has a correction record',
        );
      return this.payoutResponse(previous);
    }
    const session = await this.connection.startSession();
    let result!: DeliveryPayoutDocument;
    try {
      await session.withTransaction(async () => {
        const original = await this.payouts
          .findById(id(payoutId))
          .session(session);
        if (!original || original.reversesPayoutId)
          throw new BadRequestException('Choose an original payout record');
        const released = await this.ledger.updateMany(
          { _id: { $in: original.earningIds }, payoutId: original._id },
          { $unset: { payoutId: 1 } },
          { session },
        );
        if (released.modifiedCount !== original.earningIds.length)
          throw new ConflictException(
            'The payout allocation changed. Reload its history.',
          );
        const [record] = await this.payouts.create(
          [
            {
              requestId: dto.requestId,
              fingerprint: hash,
              transporterId: original.transporterId,
              earningIds: original.earningIds,
              amountMinor: original.amountMinor,
              paidAt: new Date(),
              reference: `Correction of ${original.reference}`,
              reason: dto.reason,
              recordedBy: id(actor.id),
              reversesPayoutId: original._id,
            },
          ],
          { session },
        );
        await this.audit(
          'payout.record_corrected',
          'DeliveryPayout',
          record._id,
          actor,
          dto.reason,
          session,
        );
        result = record;
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const prior = await this.payouts
          .findOne({ reversesPayoutId: id(payoutId) })
          .select('+fingerprint');
        if (prior?.requestId === dto.requestId && prior.fingerprint === hash)
          return this.payoutResponse(prior);
        throw new ConflictException('Payout correction already recorded');
      }
      throw error;
    } finally {
      await session.endSession();
    }
    this.notifications.notifyInBackground({
      userIds: [result.transporterId],
      type: NotificationType.PayoutRecorded,
      title: 'Payout record corrected',
      message:
        'An administrator corrected a manual payment record. The original record remains in your payout history. This correction does not reverse a bank transfer.',
    });
    return this.payoutResponse(result);
  }
  async refundRecord(orderId: string) {
    const record = await this.refunds.findOne({ orderId: id(orderId) });
    return record ? this.refundResponse(record) : null;
  }
  async refund(orderId: string, dto: ManualTransferDto, actor: RequestUser) {
    const paidAt = transferDate(dto.paidAt);
    const amountMinor = minor(dto.amount);
    const hash = fingerprint([
      orderId,
      amountMinor,
      paidAt.toISOString(),
      dto.reference,
      dto.reason,
    ]);
    const existing = await this.refunds
      .findOne({ orderId: id(orderId) })
      .select('+fingerprint');
    if (existing) {
      if (existing.requestId !== dto.requestId || existing.fingerprint !== hash)
        throw new ConflictException(
          'An external refund has already been recorded for this order',
        );
      return this.refundResponse(existing);
    }
    const session = await this.connection.startSession();
    let result!: ManualRefundDocument;
    let buyerId!: Types.ObjectId;
    try {
      await session.withTransaction(async () => {
        const order = await this.orders.findById(id(orderId)).session(session);
        if (!order || order.status !== OrderStatus.Cancelled)
          throw new ConflictException(
            'Resolve and cancel the delivery before recording an external refund',
          );
        const payment = await this.payments
          .findOne({ orderId: order._id, status: PaymentStatus.Success })
          .session(session);
        if (!payment || minor(payment.amount) !== amountMinor)
          throw new ConflictException(
            'Refund must match the full successfully settled payment',
          );
        const [record] = await this.refunds.create(
          [
            {
              orderId: order._id,
              requestId: dto.requestId,
              fingerprint: hash,
              amountMinor,
              paidAt,
              reference: dto.reference,
              reason: dto.reason,
              recordedBy: id(actor.id),
            },
          ],
          { session },
        );
        payment.status = PaymentStatus.Refunded;
        payment.refundedAt = paidAt;
        await payment.save({ session });
        await this.audit(
          'payment.external_refund_recorded',
          'Order',
          order._id,
          actor,
          dto.reason,
          session,
        );
        result = record;
        buyerId = order.buyerId;
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const prior = await this.refunds
          .findOne({ orderId: id(orderId) })
          .select('+fingerprint');
        if (prior?.requestId === dto.requestId && prior.fingerprint === hash)
          return this.refundResponse(prior);
        throw new ConflictException('Refund has already been recorded');
      }
      throw error;
    } finally {
      await session.endSession();
    }
    this.notifications.notifyInBackground({
      userIds: [buyerId],
      type: NotificationType.AdminAction,
      title: 'External refund recorded',
      message: `An administrator recorded your refund of PKR ${dto.amount}. Reference: ${dto.reference}.`,
    });
    return this.refundResponse(result);
  }
  private refundResponse(record: ManualRefundDocument) {
    return {
      id: String(record._id),
      recordedBy: String(record.recordedBy),
      orderId: String(record.orderId),
      amount: record.amountMinor / 100,
      reference: record.reference,
      paidAt: record.paidAt,
      createdAt: record.createdAt,
    };
  }
}
