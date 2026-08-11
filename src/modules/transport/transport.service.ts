import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/guards/roles.guard';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from '../auth/schemas/farmer-profile.schema';
import {
  BlockchainReferenceModel,
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../blockchain/schemas/blockchain-transaction.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../order/schemas/order.schema';
import {
  AvailableDeliveryResponseDto,
  ShipmentResponseDto,
  UpdateShipmentStatusDto,
} from './dto';
import {
  Shipment,
  ShipmentDocument,
  ShipmentStatus,
} from './schemas/shipment.schema';

const ESTIMATED_DELIVERY_MS = 48 * 60 * 60 * 1000;

const NEXT_SHIPMENT_STATUSES: Record<ShipmentStatus, ShipmentStatus[]> = {
  [ShipmentStatus.Assigned]: [ShipmentStatus.PickedUp, ShipmentStatus.Failed],
  [ShipmentStatus.PickedUp]: [ShipmentStatus.InTransit, ShipmentStatus.Failed],
  [ShipmentStatus.InTransit]: [ShipmentStatus.Delivered, ShipmentStatus.Failed],
  [ShipmentStatus.Delivered]: [],
  [ShipmentStatus.Failed]: [],
};

@Injectable()
export class TransportService {
  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
    @InjectModel(Shipment.name)
    private readonly shipmentModel: Model<ShipmentDocument>,
    @InjectModel(BlockchainTransaction.name)
    private readonly blockchainModel: Model<BlockchainTransactionDocument>,
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  async findAvailable(): Promise<AvailableDeliveryResponseDto[]> {
    const orders = await this.orderModel
      .find({
        status: OrderStatus.Paid,
        shipmentId: { $exists: false },
      })
      .exec();
    if (orders.length === 0) return [];

    const farmerIds = [
      ...new Set(orders.map((order) => order.farmerId.toHexString())),
    ].map((id) => new Types.ObjectId(id));
    const profiles = await this.farmerProfileModel
      .find({ userId: { $in: farmerIds } })
      .exec();
    const profilesByFarmerId = new Map(
      profiles.map((profile) => [profile.userId.toHexString(), profile]),
    );

    return orders.flatMap((order) => {
      const location = profilesByFarmerId.get(
        order.farmerId.toHexString(),
      )?.farmLocation;
      if (!this.hasCompleteFarmLocation(location)) return [];

      return [
        {
          orderId: order._id.toHexString(),
          pickupCity: location.city,
          pickupProvince: location.province,
          deliveryCity: order.shippingAddress.city ?? '',
          deliveryProvince: order.shippingAddress.province ?? '',
          itemCount: order.items.length,
          createdAt: order.createdAt.toISOString(),
        },
      ];
    });
  }

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

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
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

        const farmerProfile = await this.farmerProfileModel
          .findOne({ userId: eligibleOrder.farmerId })
          .session(session)
          .exec();
        if (!this.hasCompleteFarmLocation(farmerProfile?.farmLocation)) {
          throw new ConflictException(
            'Delivery pickup location is unavailable',
          );
        }
        const pickupAddress = {
          street: farmerProfile.farmLocation.address,
          city: farmerProfile.farmLocation.city,
          province: farmerProfile.farmLocation.province,
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

        const now = new Date();
        const transporterObjectId = new Types.ObjectId(transporterId);
        const [shipment] = await this.shipmentModel.create(
          [
            {
              orderId: order._id,
              transporterId: transporterObjectId,
              status: ShipmentStatus.Assigned,
              pickupAddress,
              deliveryAddress: order.shippingAddress,
              estimatedDelivery: new Date(
                now.getTime() + ESTIMATED_DELIVERY_MS,
              ),
              statusHistory: [
                {
                  status: ShipmentStatus.Assigned,
                  timestamp: now,
                  note: 'Shipment claimed by transporter',
                  updatedBy: transporterObjectId,
                },
              ],
            },
          ],
          { session },
        );

        await this.blockchainModel.create(
          [
            {
              type: BlockchainTxType.SupplyChainEvent,
              referenceId: shipment._id,
              referenceModel: BlockchainReferenceModel.Shipment,
              payload: {
                payment: null,
                supplyChain: {
                  farmerId: order.farmerId,
                  eventType: 'shipment_assigned',
                  location: `${pickupAddress.city}, ${pickupAddress.province}`,
                  actorId: transporterObjectId,
                  actorRole: UserRole.Transporter,
                  timestamp: now,
                },
              },
              status: BlockchainTxStatus.Pending,
            },
          ],
          { session },
        );

        order.shipmentId = shipment._id;
        await order.save({ session });
        return this.toResponse(shipment);
      });
    } finally {
      await session.endSession();
    }
  }

  async findAll(user: RequestUser): Promise<ShipmentResponseDto[]> {
    const filter = await this.scopeFilter(user);
    const shipments = await this.shipmentModel.find(filter).exec();
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
    try {
      return await session.withTransaction(async () => {
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

        await this.blockchainModel.create(
          [
            {
              type: BlockchainTxType.SupplyChainEvent,
              referenceId: shipment._id,
              referenceModel: BlockchainReferenceModel.Shipment,
              payload: {
                payment: null,
                supplyChain: {
                  farmerId: order.farmerId,
                  eventType: `shipment_${dto.status}`,
                  location: this.eventLocation(shipment, dto.status),
                  actorId: transporterObjectId,
                  actorRole: UserRole.Transporter,
                  timestamp: now,
                },
              },
              status: BlockchainTxStatus.Pending,
            },
          ],
          { session },
        );
        await Promise.all([
          shipment.save({ session }),
          order.save({ session }),
        ]);
        return this.toResponse(shipment);
      });
    } finally {
      await session.endSession();
    }
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

  private toResponse(shipment: ShipmentDocument): ShipmentResponseDto {
    return {
      id: shipment.id,
      orderId: shipment.orderId.toHexString(),
      transporterId: shipment.transporterId!.toHexString(),
      status: shipment.status,
      pickupAddress: shipment.pickupAddress ?? {},
      deliveryAddress: shipment.deliveryAddress ?? {},
      statusHistory: shipment.statusHistory.map((entry) => ({
        status: entry.status,
        timestamp: entry.timestamp.toISOString(),
        note: entry.note,
        updatedBy: entry.updatedBy?.toHexString(),
      })),
      estimatedDelivery: shipment.estimatedDelivery?.toISOString(),
      actualDelivery: shipment.actualDelivery?.toISOString(),
      createdAt: shipment.createdAt.toISOString(),
      updatedAt: shipment.updatedAt.toISOString(),
    };
  }
}
