import { Payment, PaymentDocument } from '../payment/schemas/payment.schema';
import { activeDeliveryFilter } from '../transport/active-delivery';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
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
  Product,
  ProductDocument,
} from '../marketplace/schemas/product.schema';
import {
  Shipment,
  ShipmentDocument,
  ShipmentStatus,
} from '../transport/schemas/shipment.schema';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import {
  SystemConfig,
  SystemConfigDocument,
} from './schemas/system-config.schema';
import { SystemConfigService } from './services/system-config.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/guards/roles.guard';
import {
  AdminQueryDto,
  SaveAdminConfigDto,
  SetUserStatusDto,
} from './dto/admin.dto';

const REVISION_KEY = 'admin_config_revision';
export const ADMIN_CONFIG_FIELDS = [
  {
    key: 'platform_fee_percent',
    label: 'Platform fee (%)',
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    key: 'min_loan_amount',
    label: 'Minimum loan (PKR)',
    min: 1,
    max: 1000000000,
    step: 1,
  },
  {
    key: 'max_loan_amount',
    label: 'Maximum loan (PKR)',
    min: 1,
    max: 1000000000,
    step: 1,
  },
  {
    key: 'delivery_base_fee',
    label: 'Delivery base fee (PKR)',
    min: 0,
    max: 100000,
    step: 1,
  },
  {
    key: 'delivery_fee_per_km',
    label: 'Delivery fee per km (PKR)',
    min: 0,
    max: 10000,
    step: 1,
  },
  {
    key: 'delivery_road_factor',
    label: 'Estimated road distance multiplier',
    min: 1,
    max: 3,
    step: 0.1,
  },
  {
    key: 'dispatch_radius_km',
    label: 'Dispatch radius (km)',
    min: 1,
    max: 500,
    step: 1,
  },
  {
    key: 'transporter_location_max_age_minutes',
    label: 'Location freshness limit (minutes)',
    min: 1,
    max: 1440,
    step: 1,
  },
] as const;
const SAFE_AUDIT_KEYS = new Set([
  'isActive',
  'hidden',
  'reason',
  'status',
  'revision',
  ...ADMIN_CONFIG_FIELDS.map((field) => field.key),
]);
function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) =>
        SAFE_AUDIT_KEYS.has(key) &&
        (typeof item === 'string' ||
          typeof item === 'boolean' ||
          typeof item === 'number'),
    ),
  );
}
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function objectId(id: string) {
  if (!Types.ObjectId.isValid(id))
    throw new NotFoundException('Record not found');
  return new Types.ObjectId(id);
}
function safeUser(user: {
  _id: Types.ObjectId;
  email: string;
  role: UserRole;
  fullName?: string;
  phone?: string;
  isActive: boolean;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    phone: user.phone,
    isActive: user.isActive,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<ShipmentDocument>,
    @InjectModel(TransporterProfile.name)
    private readonly transporterModel: Model<TransporterProfileDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditModel: Model<AuditLogDocument>,
    @InjectModel(SystemConfig.name)
    private readonly configModel: Model<SystemConfigDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly settings: SystemConfigService,
    private readonly notifications: NotificationService,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
  ) {}

  async overview() {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 6);
    const [users, products, orders, unassigned, active, failed, daily, recent] =
      await Promise.all([
        this.userModel.countDocuments(),
        this.productModel.countDocuments(),
        this.orderModel.countDocuments(),
        this.orderModel.countDocuments({
          status: OrderStatus.Paid,
          shipmentId: { $exists: false },
        }),
        this.shipmentModel.countDocuments(activeDeliveryFilter()),
        this.shipmentModel.countDocuments({
          status: ShipmentStatus.Failed,
          'issue.resolvedAt': { $exists: false },
        }),
        this.orderModel.aggregate<{ date: string; count: number }>([
          { $match: { createdAt: { $gte: since } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$createdAt',
                  timezone: 'UTC',
                },
              },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, date: '$_id', count: 1 } },
          { $sort: { date: 1 } },
        ]),
        this.audit({ page: 1, limit: 5 }),
      ]);
    const weeklyOrders = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(since);
      date.setUTCDate(date.getUTCDate() + offset);
      const key = date.toISOString().slice(0, 10);
      return {
        date: key,
        count: daily.find((day) => day.date === key)?.count ?? 0,
      };
    });
    return {
      counts: {
        users,
        products,
        orders,
        unassignedPaidOrders: unassigned,
        activeShipments: active,
        failedShipments: failed,
      },
      weeklyOrders,
      recentActivity: recent.items,
      generatedAt: new Date().toISOString(),
    };
  }

  async users(query: Partial<AdminQueryDto>) {
    const page = query.page ?? 1,
      limit = query.limit ?? 20;
    const filter: FilterQuery<UserDocument> = {};
    const role = query.role;
    const status = query.status;
    const search = query.search;
    if (role !== undefined) {
      if (typeof role !== 'string' || !Object.values(UserRole).includes(role))
        throw new BadRequestException('Unsupported user role filter');
      filter.role = role;
    }
    if (status !== undefined) {
      if (
        typeof status !== 'string' ||
        (status !== 'active' && status !== 'inactive')
      )
        throw new BadRequestException('Unsupported user status filter');
      filter.isActive = status === 'active';
    }
    if (search !== undefined && typeof search !== 'string')
      throw new BadRequestException('User search must be a string');
    if (search?.trim()) {
      const regex = new RegExp(literal(search.trim()), 'i');
      filter.$or = [{ email: regex }, { fullName: regex }];
    }
    const [items, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.userModel.countDocuments(filter),
    ]);
    return { items: items.map(safeUser), total, page, limit };
  }
  async user(id: string) {
    const user = await this.userModel.findById(objectId(id)).lean().exec();
    if (!user) throw new NotFoundException('User not found');
    return safeUser(user);
  }

  async setUserStatus(id: string, dto: SetUserStatusDto, actor: RequestUser) {
    const target = objectId(id);
    const session = await this.connection.startSession();
    let changed = false;
    let result: ReturnType<typeof safeUser> | undefined;
    try {
      await session.withTransaction(async () => {
        changed = false;
        const user = await this.userModel
          .findById(target)
          .session(session)
          .exec();
        if (!user) throw new NotFoundException('User not found');
        if (user.role === UserRole.Admin || id === actor.id)
          throw new ForbiddenException(
            'Administrator accounts cannot be deactivated here',
          );
        if (user.isActive === dto.isActive) {
          result = safeUser(user);
          return;
        }
        if (user.role === UserRole.Transporter) {
          // Serializes against claims, which also write this profile inside a transaction.
          await this.transporterModel.updateOne(
            { userId: target },
            { $set: { dispatchSuspended: !dto.isActive, isAvailable: false } },
            { session },
          );
        }
        if (!dto.isActive) {
          const activeDelivery = await this.shipmentModel
            .exists({ transporterId: target, ...activeDeliveryFilter() })
            .session(session);
          const unresolvedOrder = await this.orderModel
            .exists({
              $or: [{ buyerId: target }, { farmerId: target }],
              status: {
                $in: [
                  OrderStatus.Paid,
                  OrderStatus.Processing,
                  OrderStatus.Shipped,
                ],
              },
            })
            .session(session);
          const pendingOrders = await this.orderModel
            .find({
              $or: [{ buyerId: target }, { farmerId: target }],
              status: OrderStatus.Pending,
            })
            .select('_id paymentStartedAt paymentId')
            .session(session);
          // The claim is committed before contacting a gateway. Keep accounts
          // usable even when the gateway result is unknown or persistence failed.
          const pendingPayment =
            pendingOrders.some(
              (order) => order.paymentStartedAt || order.paymentId,
            ) ||
            (pendingOrders.length > 0 &&
              (await this.paymentModel
                .exists({
                  orderId: { $in: pendingOrders.map((order) => order._id) },
                })
                .session(session)));
          if (activeDelivery || unresolvedOrder || pendingPayment)
            throw new ConflictException(
              'Resolve the active delivery, paid orders or existing payment sessions before deactivating this account',
            );
        }
        const before = user.isActive;
        user.isActive = dto.isActive;
        await user.save({ session });
        await this.auditModel.create(
          [
            {
              actorId: objectId(actor.id),
              actorRole: actor.role,
              action: dto.isActive ? 'user.activated' : 'user.deactivated',
              targetEntity: 'User',
              targetId: target,
              metadata: {
                before: { isActive: before },
                after: { isActive: dto.isActive, reason: dto.reason },
              },
            },
          ],
          { session },
        );
        changed = true;
        result = safeUser(user);
      });
    } finally {
      await session.endSession();
    }
    if (changed)
      this.notifications.notifyInBackground({
        userIds: [id],
        type: NotificationType.AdminAction,
        title: dto.isActive ? 'Account reactivated' : 'Account deactivated',
        message: dto.reason,
      });
    return result!;
  }

  async audit(query: Partial<AdminQueryDto>) {
    const page = query.page ?? 1,
      limit = query.limit ?? 20;
    const filter: FilterQuery<AuditLogDocument> = {};
    const action = query.action;
    const entity = query.entity;
    const search = query.search;
    if (action !== undefined && typeof action !== 'string')
      throw new BadRequestException('Audit action filter must be a string');
    if (entity !== undefined && typeof entity !== 'string')
      throw new BadRequestException('Audit entity filter must be a string');
    if (search !== undefined && typeof search !== 'string')
      throw new BadRequestException('Audit search must be a string');
    if (action) filter.action = action;
    if (entity) filter.targetEntity = entity;
    if (search?.trim()) filter.action = new RegExp(literal(search.trim()), 'i');
    const [items, total] = await Promise.all([
      this.auditModel
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.auditModel.countDocuments(filter),
    ]);
    return {
      items: items.map((item) => ({
        id: String(item._id),
        actorId: String(item.actorId),
        actorRole: item.actorRole,
        action: item.action,
        targetEntity: item.targetEntity,
        targetId: item.targetId ? String(item.targetId) : undefined,
        createdAt: item.createdAt,
        metadata: {
          before: safeMetadata(item.metadata?.before),
          after: safeMetadata(item.metadata?.after),
        },
      })),
      total,
      page,
      limit,
    };
  }

  async config() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const beforeRevision = Number(
        (await this.configModel.findOne({ key: REVISION_KEY }).lean().exec())
          ?.value ?? 0,
      );
      const [documents, fee, loans, delivery] = await Promise.all([
        this.configModel.find().lean().exec(),
        this.settings.getPlatformFeePercent(),
        this.settings.getLoanLimits(),
        this.settings.getDeliverySettings(),
      ]);
      const effective: Record<string, number> = {
        platform_fee_percent: fee,
        min_loan_amount: loans.min,
        max_loan_amount: loans.max,
        delivery_base_fee: delivery.baseFee,
        delivery_fee_per_km: delivery.feePerKm,
        delivery_road_factor: delivery.roadFactor,
        dispatch_radius_km: delivery.radiusKm,
        transporter_location_max_age_minutes: delivery.locationMaxAgeMinutes,
      };
      const afterRevision = Number(
        (await this.configModel.findOne({ key: REVISION_KEY }).lean().exec())
          ?.value ?? 0,
      );
      if (beforeRevision !== afterRevision) continue;
      return {
        revision: afterRevision,
        items: ADMIN_CONFIG_FIELDS.map((field) => {
          const doc = documents.find((item) => item.key === field.key);
          return {
            ...field,
            effectiveValue: effective[field.key],
            source:
              doc && Number(doc.value) === effective[field.key]
                ? 'stored'
                : 'default',
            updatedAt: doc?.updatedAt,
          };
        }),
      };
    }
    throw new ConflictException('Configuration is changing. Please reload.');
  }
  async saveConfig(dto: SaveAdminConfigDto, actor: RequestUser) {
    const keys = Object.keys(dto.values);
    if (
      keys.length !== ADMIN_CONFIG_FIELDS.length ||
      keys.some(
        (key) => !ADMIN_CONFIG_FIELDS.some((field) => field.key === key),
      )
    )
      throw new BadRequestException(
        'Provide only the supported configuration keys',
      );
    for (const field of ADMIN_CONFIG_FIELDS) {
      const value = dto.values[field.key];
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < field.min ||
        value > field.max ||
        (field.step === 1 && !Number.isInteger(value))
      )
        throw new BadRequestException(
          `${field.label} must be between ${field.min} and ${field.max}`,
        );
    }
    if (dto.values.min_loan_amount > dto.values.max_loan_amount)
      throw new BadRequestException(
        'Minimum loan must not exceed maximum loan',
      );
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const revision = await this.configModel
          .findOne({ key: REVISION_KEY })
          .session(session);
        if (Number(revision?.value ?? 0) !== dto.revision)
          throw new ConflictException(
            'Configuration changed. Reload the current values before saving again.',
          );
        if (revision) {
          revision.value = dto.revision + 1;
          revision.updatedBy = objectId(actor.id);
          await revision.save({ session });
        } else
          await this.configModel.create(
            [{ key: REVISION_KEY, value: 1, updatedBy: objectId(actor.id) }],
            { session },
          );
        const before = await this.configModel
          .find({ key: { $in: keys } })
          .session(session)
          .lean();
        for (const key of keys)
          await this.configModel.updateOne(
            { key },
            { $set: { value: dto.values[key], updatedBy: objectId(actor.id) } },
            { upsert: true, session },
          );
        await this.auditModel.create(
          [
            {
              actorId: objectId(actor.id),
              actorRole: actor.role,
              action: 'config.updated',
              targetEntity: 'SystemConfig',
              metadata: {
                before: Object.fromEntries(
                  before.map((item) => [item.key, item.value]),
                ),
                after: {
                  ...dto.values,
                  reason: dto.reason,
                  revision: dto.revision + 1,
                },
              },
            },
          ],
          { session },
        );
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new ConflictException(
          'Configuration changed. Reload before saving again.',
        );
      throw error;
    } finally {
      await session.endSession();
    }
    return {
      revision: dto.revision + 1,
      items: ADMIN_CONFIG_FIELDS.map((field) => ({
        ...field,
        effectiveValue: dto.values[field.key],
        source: 'stored' as const,
      })),
    };
  }
}
