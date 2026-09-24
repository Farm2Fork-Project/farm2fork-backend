import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  LatLng,
  approximate,
  fromGeoPoint,
  haversineKm,
  toGeoPoint,
} from '../../common/geo/geo';
import { RequestUser } from '../../common/guards/roles.guard';
import {
  DeliverySettings,
  SystemConfigService,
} from '../admin/services/system-config.service';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from '../auth/schemas/farmer-profile.schema';
import {
  TransporterProfile,
  TransporterProfileDocument,
} from '../auth/schemas/transporter-profile.schema';
import {
  BlockchainReferenceModel,
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../blockchain/schemas/blockchain-transaction.schema';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../order/schemas/order.schema';
import {
  AvailableDeliveryResponseDto,
  ShipmentResponseDto,
  TransporterStatusDto,
  UpdateAvailabilityDto,
  UpdateShipmentStatusDto,
} from './dto';
import {
  Shipment,
  ShipmentDocument,
  ShipmentStatus,
} from './schemas/shipment.schema';

const ESTIMATED_DELIVERY_MS = 48 * 60 * 60 * 1000;

/** How many nearby transporters are pinged for one new delivery. */
const MAX_OFFER_RECIPIENTS = 30;
const MAX_OFFERS_LISTED = 50;

const ACTIVE_SHIPMENT_STATUSES = [
  ShipmentStatus.Assigned,
  ShipmentStatus.PickedUp,
  ShipmentStatus.InTransit,
];

const NEXT_SHIPMENT_STATUSES: Record<ShipmentStatus, ShipmentStatus[]> = {
  [ShipmentStatus.Assigned]: [ShipmentStatus.PickedUp, ShipmentStatus.Failed],
  [ShipmentStatus.PickedUp]: [ShipmentStatus.InTransit, ShipmentStatus.Failed],
  [ShipmentStatus.InTransit]: [ShipmentStatus.Delivered, ShipmentStatus.Failed],
  [ShipmentStatus.Delivered]: [],
  [ShipmentStatus.Failed]: [],
};

const STATUS_UPDATE_COPY: Partial<
  Record<ShipmentStatus, { title: string; message: string }>
> = {
  [ShipmentStatus.PickedUp]: {
    title: 'Order picked up',
    message: 'has been collected from the farm.',
  },
  [ShipmentStatus.InTransit]: {
    title: 'Order on the way',
    message: 'is on its way to the drop-off location.',
  },
  [ShipmentStatus.Delivered]: {
    title: 'Order delivered',
    message: 'has been delivered.',
  },
  [ShipmentStatus.Failed]: {
    title: 'Delivery failed',
    message: 'could not be delivered. Farm2Fork support will follow up.',
  },
};

/**
 * TransportService (EP-07): proximity dispatch and delivery tracking.
 *
 * When an order is paid, available transporters near the farm (recent
 * location within the dispatch radius, no delivery in progress) are pinged
 * with a fixed-price offer. Any of them can decline, or accept - the first
 * accept wins atomically and becomes the shipment.
 */
@Injectable()
export class TransportService {
  private readonly logger = new Logger(TransportService.name);

  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
    @InjectModel(TransporterProfile.name)
    private readonly transporterProfileModel: Model<TransporterProfileDocument>,
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<ShipmentDocument>,
    @InjectModel(BlockchainTransaction.name)
    private readonly blockchainModel: Model<BlockchainTransactionDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly systemConfig: SystemConfigService,
    private readonly notifications: NotificationService,
  ) {}

  // --- transporter availability ---------------------------------------------

  async getTransporterStatus(
    transporterId: string,
  ): Promise<TransporterStatusDto> {
    const [profile, settings, active] = await Promise.all([
      this.requireTransporterProfile(transporterId),
      this.systemConfig.getDeliverySettings(),
      this.findActiveShipment(transporterId),
    ]);
    return {
      online: profile.isAvailable,
      locationFresh: this.isLocationFresh(profile, settings),
      lastLocationAt: profile.lastLocationAt?.toISOString(),
      activeShipmentId: active?._id.toHexString(),
      radiusKm: settings.radiusKm,
    };
  }

  async updateAvailability(
    transporterId: string,
    dto: UpdateAvailabilityDto,
  ): Promise<TransporterStatusDto> {
    const update: Record<string, unknown> = { isAvailable: dto.online };
    if (dto.location) {
      update.lastLocation = toGeoPoint(dto.location);
      update.lastLocationAt = new Date();
    }
    await this.updateTransporterProfile(transporterId, update);
    return this.getTransporterStatus(transporterId);
  }

  /** Foreground heartbeat from the app while the transporter is online. */
  async updateLocation(transporterId: string, location: LatLng): Promise<void> {
    await this.updateTransporterProfile(transporterId, {
      lastLocation: toGeoPoint(location),
      lastLocationAt: new Date(),
    });
  }

  // --- offers ---------------------------------------------------------------

  /**
   * Paid, unclaimed orders whose farm is within the dispatch radius of the
   * transporter's recent location, nearest first. Empty while offline, with
   * a stale location, or with a delivery already in progress.
   */
  async findAvailable(
    transporterId: string,
  ): Promise<AvailableDeliveryResponseDto[]> {
    const [profile, settings, active] = await Promise.all([
      this.requireTransporterProfile(transporterId),
      this.systemConfig.getDeliverySettings(),
      this.findActiveShipment(transporterId),
    ]);
    if (
      !profile.isAvailable ||
      active ||
      !profile.lastLocation ||
      !this.isLocationFresh(profile, settings)
    ) {
      return [];
    }

    const here = fromGeoPoint(profile.lastLocation);
    const orders = await this.orderModel
      .find({
        status: OrderStatus.Paid,
        shipmentId: { $exists: false },
        declinedBy: { $ne: new Types.ObjectId(transporterId) },
        pickupLocation: {
          $nearSphere: {
            $geometry: toGeoPoint(here),
            $maxDistance: settings.radiusKm * 1000,
          },
        },
      })
      .limit(MAX_OFFERS_LISTED)
      .exec();
    if (orders.length === 0) return [];

    const profiles = await this.farmerProfileModel
      .find({ userId: { $in: orders.map((order) => order.farmerId) } })
      .select('userId farmName farmLocation')
      .lean()
      .exec();
    const farms = new Map(profiles.map((p) => [p.userId.toHexString(), p]));

    return orders.flatMap((order) => {
      const farm = farms.get(order.farmerId.toHexString());
      if (
        !farm ||
        !order.pickupLocation ||
        !this.hasCompleteFarmLocation(farm.farmLocation)
      ) {
        return [];
      }
      return [this.toOffer(order, farm, here)];
    });
  }

  async decline(orderId: string, transporterId: string): Promise<void> {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new NotFoundException('Delivery offer not found');
    }
    const result = await this.orderModel
      .updateOne(
        { _id: new Types.ObjectId(orderId), status: OrderStatus.Paid },
        { $addToSet: { declinedBy: new Types.ObjectId(transporterId) } },
      )
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException('Delivery offer not found');
    }
  }

  /**
   * Pings nearby available transporters about a newly paid order. Called
   * after the payment transaction commits; failures are logged, never
   * surfaced to the buyer (the offer stays listed either way).
   */
  dispatchInBackground(orderId: Types.ObjectId | string): void {
    this.dispatch(orderId).catch((error: unknown) =>
      this.logger.error(
        `Dispatch for order ${String(orderId)} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      ),
    );
  }

  async dispatch(orderId: Types.ObjectId | string): Promise<number> {
    const order = await this.orderModel.findById(orderId).exec();
    if (
      !order?.pickupLocation ||
      order.status !== OrderStatus.Paid ||
      order.shipmentId
    ) {
      return 0;
    }
    const settings = await this.systemConfig.getDeliverySettings();
    const candidates = await this.transporterProfileModel
      .find({
        isAvailable: true,
        lastLocationAt: { $gte: this.freshnessCutoff(settings) },
        userId: { $nin: order.declinedBy },
        lastLocation: {
          $nearSphere: {
            $geometry: order.pickupLocation,
            $maxDistance: settings.radiusKm * 1000,
          },
        },
      })
      .select('userId')
      .limit(MAX_OFFER_RECIPIENTS * 2)
      .lean()
      .exec();
    if (candidates.length === 0) return 0;

    const busy = await this.shipmentModel
      .distinct('transporterId', {
        transporterId: { $in: candidates.map((c) => c.userId) },
        status: { $in: ACTIVE_SHIPMENT_STATUSES },
      })
      .exec();
    const busyIds = new Set(busy.map((id) => String(id)));
    const recipients = candidates
      .map((c) => c.userId)
      .filter((id) => !busyIds.has(id.toHexString()))
      .slice(0, MAX_OFFER_RECIPIENTS);
    if (recipients.length === 0) return 0;

    const farm = await this.farmerProfileModel
      .findOne({ userId: order.farmerId })
      .select('farmLocation')
      .lean()
      .exec();
    const from = farm?.farmLocation?.city ?? 'a farm';
    const to = order.shippingAddress.city ?? 'the buyer';
    await this.notifications.notify({
      userIds: recipients,
      type: NotificationType.DeliveryOffer,
      title: `New delivery · Rs ${order.deliveryFee.toLocaleString('en-PK')}`,
      message: `${from} → ${to}${order.deliveryDistanceKm ? ` (${order.deliveryDistanceKm} km)` : ''}. Open the app to accept or decline.`,
      relatedEntityId: order._id,
      relatedEntityModel: 'Order',
    });
    return recipients.length;
  }

  // --- claim and status -----------------------------------------------------

  /** Accepts an offer. The first transporter to accept gets the delivery. */
  async claim(
    orderId: string,
    transporterId: string,
  ): Promise<ShipmentResponseDto> {
    if (
      !Types.ObjectId.isValid(orderId) ||
      !Types.ObjectId.isValid(transporterId)
    ) {
      throw new ConflictException('Delivery is no longer available');
    }
    const settings = await this.systemConfig.getDeliverySettings();

    const session = await this.connection.startSession();
    let result: { shipment: ShipmentDocument; order: OrderDocument };
    try {
      result = await session.withTransaction(async () => {
        const transporterObjectId = new Types.ObjectId(transporterId);
        const now = new Date();

        // Writing the profile makes two concurrent claims by the same
        // transporter conflict, so the active-delivery check below is safe.
        const transporter = await this.transporterProfileModel
          .findOneAndUpdate(
            { userId: transporterObjectId },
            { $set: { lastClaimAt: now } },
            { new: true, session },
          )
          .exec();
        if (!transporter) {
          throw new NotFoundException('Transporter profile not found');
        }
        const active = await this.shipmentModel
          .exists({
            transporterId: transporterObjectId,
            status: { $in: ACTIVE_SHIPMENT_STATUSES },
          })
          .session(session)
          .exec();
        if (active) {
          throw new ConflictException(
            'Finish your current delivery before accepting another',
          );
        }
        if (!transporter.isAvailable) {
          throw new ConflictException('Go online to accept deliveries');
        }

        const claimFilter = {
          _id: new Types.ObjectId(orderId),
          status: OrderStatus.Paid,
          shipmentId: { $exists: false },
        };
        const eligibleOrder = await this.orderModel
          .findOne(claimFilter)
          .session(session)
          .exec();
        if (!eligibleOrder) {
          throw new ConflictException('Delivery is no longer available');
        }
        if (eligibleOrder.pickupLocation) {
          if (
            !transporter.lastLocation ||
            !this.isLocationFresh(transporter, settings)
          ) {
            throw new ConflictException(
              'Share your current location to accept deliveries',
            );
          }
          const distance = haversineKm(
            fromGeoPoint(transporter.lastLocation),
            fromGeoPoint(eligibleOrder.pickupLocation),
          );
          if (distance > settings.radiusKm) {
            throw new ConflictException('This delivery is outside your area');
          }
        }

        const farmerProfile = await this.farmerProfileModel
          .findOne({ userId: eligibleOrder.farmerId })
          .session(session)
          .exec();
        if (!this.hasCompleteFarmLocation(farmerProfile?.farmLocation)) {
          throw new ConflictException(
            'Delivery pickup location is unavailable',
          );
        }
        const pickupPin = eligibleOrder.pickupLocation
          ? fromGeoPoint(eligibleOrder.pickupLocation)
          : undefined;
        const pickupAddress = {
          street: farmerProfile.farmLocation.address,
          city: farmerProfile.farmLocation.city,
          province: farmerProfile.farmLocation.province,
          ...(pickupPin ?? {}),
        };

        const order = await this.orderModel
          .findOneAndUpdate(
            claimFilter,
            { $set: { status: OrderStatus.Processing } },
            { new: true, session },
          )
          .exec();
        if (!order) {
          throw new ConflictException('Delivery is no longer available');
        }

        const [shipment] = await this.shipmentModel.create(
          [
            {
              orderId: order._id,
              transporterId: transporterObjectId,
              status: ShipmentStatus.Assigned,
              pickupAddress,
              deliveryAddress: order.shippingAddress,
              deliveryFee: order.deliveryFee ?? 0,
              estimatedDelivery: new Date(
                now.getTime() + ESTIMATED_DELIVERY_MS,
              ),
              statusHistory: [
                {
                  status: ShipmentStatus.Assigned,
                  timestamp: now,
                  note: 'Delivery accepted by transporter',
                  updatedBy: transporterObjectId,
                },
              ],
            },
          ],
          { session },
        );

        await this.createShipmentSupplyChainEvents(
          order,
          shipment,
          'shipment_assigned',
          `${pickupAddress.city}, ${pickupAddress.province}`,
          transporterObjectId,
          now,
          session,
        );

        order.shipmentId = shipment._id;
        await order.save({ session });
        return { shipment, order };
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('Delivery is no longer available');
      }
      throw error;
    } finally {
      await session.endSession();
    }

    const { shipment, order } = result;
    const label = this.orderLabel(order);
    this.notifications.notifyInBackground({
      userIds: [order.buyerId, order.farmerId],
      type: NotificationType.ShipmentAssigned,
      title: 'Transporter assigned',
      message: `A transporter accepted order ${label} and is heading to the farm for pickup.`,
      relatedEntityId: shipment._id,
      relatedEntityModel: 'Shipment',
    });
    this.notifications.notifyInBackground({
      userIds: [transporterId],
      type: NotificationType.ShipmentAssigned,
      title: 'Delivery accepted',
      message: `Order ${label} is yours. Head to ${shipment.pickupAddress?.city ?? 'the farm'} for pickup.`,
      relatedEntityId: shipment._id,
      relatedEntityModel: 'Shipment',
    });
    return this.toResponse(shipment);
  }

  async findAll(user: RequestUser): Promise<ShipmentResponseDto[]> {
    const filter = await this.scopeFilter(user);
    const shipments = await this.shipmentModel
      .find(filter)
      .sort({ createdAt: -1 })
      .exec();
    return shipments.map((shipment) => this.toResponse(shipment));
  }

  async findOne(id: string, user: RequestUser): Promise<ShipmentResponseDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Shipment not found');
    }
    const shipment = await this.shipmentModel.findById(id).exec();
    if (!shipment) throw new NotFoundException('Shipment not found');
    await this.assertReadAccess(shipment, user);
    return this.toResponse(shipment);
  }

  async updateStatus(
    shipmentId: string,
    transporterId: string,
    dto: UpdateShipmentStatusDto,
  ): Promise<ShipmentResponseDto> {
    if (
      !Types.ObjectId.isValid(shipmentId) ||
      !Types.ObjectId.isValid(transporterId)
    ) {
      throw new NotFoundException('Shipment not found');
    }

    const session = await this.connection.startSession();
    let result: { shipment: ShipmentDocument; order: OrderDocument };
    try {
      result = await session.withTransaction(async () => {
        const shipment = await this.shipmentModel
          .findById(shipmentId)
          .session(session)
          .exec();
        if (!shipment) throw new NotFoundException('Shipment not found');
        if (shipment.transporterId?.toHexString() !== transporterId) {
          throw new ForbiddenException(
            'You can only update your assigned deliveries',
          );
        }
        if (!NEXT_SHIPMENT_STATUSES[shipment.status].includes(dto.status)) {
          throw new BadRequestException('Invalid shipment status transition');
        }

        const order = await this.orderModel
          .findById(shipment.orderId)
          .session(session)
          .exec();
        if (!order) throw new NotFoundException('Order not found');

        const now = new Date();
        const transporterObjectId = new Types.ObjectId(transporterId);
        shipment.status = dto.status;
        shipment.statusHistory.push({
          status: dto.status,
          timestamp: now,
          note: dto.note,
          updatedBy: transporterObjectId,
        });
        if (
          dto.status === ShipmentStatus.PickedUp ||
          dto.status === ShipmentStatus.InTransit
        ) {
          order.status = OrderStatus.Shipped;
        } else if (dto.status === ShipmentStatus.Delivered) {
          order.status = OrderStatus.Delivered;
          shipment.actualDelivery = now;
        }

        await this.createShipmentSupplyChainEvents(
          order,
          shipment,
          `shipment_${dto.status}`,
          this.eventLocation(shipment, dto.status),
          transporterObjectId,
          now,
          session,
        );
        await Promise.all([
          shipment.save({ session }),
          order.save({ session }),
        ]);
        return { shipment, order };
      });
    } finally {
      await session.endSession();
    }

    const copy = STATUS_UPDATE_COPY[dto.status];
    if (copy) {
      this.notifications.notifyInBackground({
        userIds: [result.order.buyerId, result.order.farmerId],
        type: NotificationType.DeliveryUpdate,
        title: copy.title,
        message: `Order ${this.orderLabel(result.order)} ${copy.message}`,
        relatedEntityId: result.shipment._id,
        relatedEntityModel: 'Shipment',
      });
    }
    return this.toResponse(result.shipment);
  }

  // --- internals ------------------------------------------------------------

  private toOffer(
    order: OrderDocument,
    farm: Pick<FarmerProfile, 'farmName' | 'farmLocation'>,
    here: LatLng,
  ): AvailableDeliveryResponseDto {
    const pickup = fromGeoPoint(order.pickupLocation!);
    const dropoff =
      typeof order.shippingAddress.lat === 'number' &&
      typeof order.shippingAddress.lng === 'number'
        ? approximate({
            lat: order.shippingAddress.lat,
            lng: order.shippingAddress.lng,
          })
        : pickup;
    const city = farm.farmLocation?.city ?? '';
    const province = farm.farmLocation?.province ?? '';
    return {
      orderId: order._id.toHexString(),
      deliveryFee: order.deliveryFee ?? 0,
      deliveryDistanceKm: order.deliveryDistanceKm ?? 0,
      distanceToPickupKm: Math.round(haversineKm(here, pickup) * 10) / 10,
      pickup: { ...pickup, city, province },
      farmName: farm.farmName,
      dropoffArea: {
        ...dropoff,
        city: order.shippingAddress.city ?? '',
        province: order.shippingAddress.province ?? '',
      },
      items: order.items.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
      })),
      pickupCity: city,
      pickupProvince: province,
      deliveryCity: order.shippingAddress.city ?? '',
      deliveryProvince: order.shippingAddress.province ?? '',
      itemCount: order.items.length,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private async requireTransporterProfile(
    transporterId: string,
  ): Promise<TransporterProfileDocument> {
    const profile = await this.transporterProfileModel
      .findOne({ userId: new Types.ObjectId(transporterId) })
      .exec();
    if (!profile) throw new NotFoundException('Transporter profile not found');
    return profile;
  }

  private async updateTransporterProfile(
    transporterId: string,
    update: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.transporterProfileModel
      .updateOne(
        { userId: new Types.ObjectId(transporterId) },
        { $set: update },
      )
      .exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException('Transporter profile not found');
    }
  }

  private findActiveShipment(transporterId: string) {
    return this.shipmentModel
      .findOne({
        transporterId: new Types.ObjectId(transporterId),
        status: { $in: ACTIVE_SHIPMENT_STATUSES },
      })
      .select('_id')
      .lean()
      .exec();
  }

  private freshnessCutoff(settings: DeliverySettings): Date {
    return new Date(Date.now() - settings.locationMaxAgeMinutes * 60_000);
  }

  private isLocationFresh(
    profile: Pick<TransporterProfile, 'lastLocationAt'>,
    settings: DeliverySettings,
  ): boolean {
    return Boolean(
      profile.lastLocationAt &&
      profile.lastLocationAt >= this.freshnessCutoff(settings),
    );
  }

  private orderLabel(order: OrderDocument): string {
    return `#${order._id.toHexString().slice(-6).toUpperCase()}`;
  }

  private hasCompleteFarmLocation(
    location: FarmerProfile['farmLocation'] | undefined,
  ): location is Required<NonNullable<FarmerProfile['farmLocation']>> {
    return Boolean(
      location?.address?.trim() &&
      location.city?.trim() &&
      location.province?.trim(),
    );
  }

  private async scopeFilter(
    user: RequestUser,
  ): Promise<FilterQuery<ShipmentDocument>> {
    if (user.role === UserRole.Admin) return {};
    if (user.role === UserRole.Transporter) {
      return { transporterId: new Types.ObjectId(user.id) };
    }
    if (user.role !== UserRole.Buyer && user.role !== UserRole.Farmer) {
      return { _id: { $in: [] } };
    }

    const orderFilter =
      user.role === UserRole.Buyer
        ? { buyerId: new Types.ObjectId(user.id) }
        : { farmerId: new Types.ObjectId(user.id) };
    const orders = await this.orderModel.find(orderFilter).exec();
    return { orderId: { $in: orders.map((order) => order._id) } };
  }

  private async assertReadAccess(
    shipment: ShipmentDocument,
    user: RequestUser,
  ): Promise<void> {
    if (user.role === UserRole.Admin) return;
    if (
      user.role === UserRole.Transporter &&
      shipment.transporterId?.toHexString() === user.id
    ) {
      return;
    }
    if (user.role !== UserRole.Buyer && user.role !== UserRole.Farmer) {
      throw new ForbiddenException('You do not have access to this shipment');
    }

    const orderFilter =
      user.role === UserRole.Buyer
        ? { _id: shipment.orderId, buyerId: new Types.ObjectId(user.id) }
        : { _id: shipment.orderId, farmerId: new Types.ObjectId(user.id) };
    const order = await this.orderModel.findOne(orderFilter).exec();
    if (!order) {
      throw new ForbiddenException('You do not have access to this shipment');
    }
  }

  private eventLocation(
    shipment: ShipmentDocument,
    status: ShipmentStatus,
  ): string {
    const address =
      status === ShipmentStatus.Delivered
        ? shipment.deliveryAddress
        : shipment.pickupAddress;
    return [address?.city, address?.province].filter(Boolean).join(', ');
  }

  private async createShipmentSupplyChainEvents(
    order: OrderDocument,
    shipment: ShipmentDocument,
    eventType: string,
    location: string,
    actorId: Types.ObjectId,
    timestamp: Date,
    session: ClientSession,
  ): Promise<void> {
    const productIds = [
      ...new Map(
        order.items.map((item) => [
          item.productId.toHexString(),
          item.productId,
        ]),
      ).values(),
    ];

    await this.blockchainModel.create(
      productIds.map((productId) => ({
        type: BlockchainTxType.SupplyChainEvent,
        referenceId: shipment._id,
        referenceModel: BlockchainReferenceModel.Shipment,
        payload: {
          payment: null,
          supplyChain: {
            productId,
            farmerId: order.farmerId,
            eventType,
            location,
            actorId,
            actorRole: UserRole.Transporter,
            timestamp,
          },
        },
        status: BlockchainTxStatus.Pending,
      })),
      { session, ordered: true },
    );
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }

  private toResponse(shipment: ShipmentDocument): ShipmentResponseDto {
    const address = (a: ShipmentDocument['pickupAddress']) => ({
      street: a?.street,
      city: a?.city,
      province: a?.province,
      zip: a?.zip,
      lat: a?.lat,
      lng: a?.lng,
    });
    return {
      id: shipment.id,
      orderId: shipment.orderId.toHexString(),
      transporterId: shipment.transporterId!.toHexString(),
      status: shipment.status,
      pickupAddress: address(shipment.pickupAddress),
      deliveryAddress: address(shipment.deliveryAddress),
      statusHistory: shipment.statusHistory.map((entry) => ({
        status: entry.status,
        timestamp: entry.timestamp.toISOString(),
        note: entry.note,
        updatedBy: entry.updatedBy?.toHexString(),
      })),
      deliveryFee: shipment.deliveryFee,
      estimatedDelivery: shipment.estimatedDelivery?.toISOString(),
      actualDelivery: shipment.actualDelivery?.toISOString(),
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
    };
  }
}
