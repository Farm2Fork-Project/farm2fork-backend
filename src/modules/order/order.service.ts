import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { RequestUser } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import { SystemConfigService } from '../admin/services/system-config.service';
import {
  Product,
  ProductDocument,
  ProductStatus,
} from '../marketplace/schemas/product.schema';
import { Order, OrderDocument, OrderStatus } from './schemas/order.schema';
import {
  CreateOrderDto,
  OrderListResponseDto,
  OrderResponseDto,
  QueryOrderDto,
} from './dto';

/**
 * OrderService (EP-04).
 *
 * Real Mongoose persistence enforcing the core order rules:
 *  - One-Order-One-Farmer (§6.1): every item must resolve to the same farmer;
 *    a mixed-farmer request is rejected with 400.
 *  - Price snapshotting: productName and unitPrice are copied from the live
 *    product, never trusted from the client.
 *  - Percentage platform fee (§6.2): read via SystemConfigService and snapshot
 *    onto the order so later config changes don't affect existing orders.
 */
@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    private readonly systemConfig: SystemConfigService,
  ) {}

  async create(
    buyerId: string,
    dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    if (dto.items.length === 0) {
      throw new BadRequestException('An order must contain at least one item');
    }

    // Reject duplicate product lines up front so quantities are unambiguous.
    const productIds = dto.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Duplicate products in one order; combine quantities instead',
      );
    }

    const products = await this.productModel
      .find({ _id: { $in: productIds.map((id) => new Types.ObjectId(id)) } })
      .exec();

    const byId = new Map(products.map((p) => [p.id as string, p]));

    const items = dto.items.map((line) => {
      const product = byId.get(line.productId);
      if (!product) {
        throw new BadRequestException(`Product ${line.productId} not found`);
      }
      if (product.status !== ProductStatus.Active) {
        throw new BadRequestException(
          `Product ${product.name} is not available`,
        );
      }
      if (line.quantity > product.quantity) {
        throw new BadRequestException(`Insufficient stock for ${product.name}`);
      }
      // Snapshot name + price from the live product (never from the client).
      return {
        productId: product._id,
        farmerId: product.farmerId,
        productName: product.name,
        quantity: line.quantity,
        unitPrice: product.price,
        subtotal: product.price * line.quantity,
      };
    });

    // One-Order-One-Farmer: all items must share a single farmer.
    const farmerIds = new Set(items.map((i) => i.farmerId.toHexString()));
    if (farmerIds.size > 1) {
      throw new BadRequestException(
        'All items in an order must belong to the same farmer ' +
          '(One-Order-One-Farmer). Check out each farmer separately.',
      );
    }
    const farmerId = items[0].farmerId;

    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    const platformFeePercent = await this.systemConfig.getPlatformFeePercent();
    const platformFeeAmount = (totalAmount * platformFeePercent) / 100;
    const grandTotal = totalAmount + platformFeeAmount;

    const created = await this.orderModel.create({
      buyerId: new Types.ObjectId(buyerId),
      farmerId,
      items,
      totalAmount,
      platformFeePercent,
      platformFeeAmount,
      grandTotal,
      shippingAddress: dto.shippingAddress,
      status: OrderStatus.Pending,
    });

    return this.toResponse(created);
  }

  async findAll(
    user: RequestUser,
    query: QueryOrderDto,
  ): Promise<OrderListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const filter = this.scopeFilter(user, query);

    const [items, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.orderModel.countDocuments(filter).exec(),
    ]);

    return {
      data: items.map((o) => this.toResponse(o)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  async findOne(id: string, user: RequestUser): Promise<OrderResponseDto> {
    return this.toResponse(await this.getVisibleOrder(id, user));
  }

  async cancel(id: string, user: RequestUser): Promise<OrderResponseDto> {
    const order = await this.getVisibleOrder(id, user);
    if (order.buyerId.toHexString() !== user.id) {
      throw new ForbiddenException('You can only cancel your own orders');
    }
    if (
      order.status === OrderStatus.Delivered ||
      order.status === OrderStatus.Cancelled
    ) {
      throw new BadRequestException(
        `An order with status "${order.status}" cannot be cancelled`,
      );
    }
    order.status = OrderStatus.Cancelled;
    await order.save();
    return this.toResponse(order);
  }

  // --- internals -------------------------------------------------------------

  /** Builds the role-scoped query filter. */
  private scopeFilter(
    user: RequestUser,
    query: QueryOrderDto,
  ): FilterQuery<OrderDocument> {
    const filter: FilterQuery<OrderDocument> = {};
    if (query.status) filter.status = query.status;

    switch (user.role) {
      case UserRole.Buyer:
        filter.buyerId = new Types.ObjectId(user.id);
        break;
      case UserRole.Farmer:
        filter.farmerId = new Types.ObjectId(user.id);
        break;
      case UserRole.Admin:
        // Admin may additionally filter by buyer/farmer.
        if (query.buyerId) filter.buyerId = new Types.ObjectId(query.buyerId);
        if (query.farmerId) {
          filter.farmerId = new Types.ObjectId(query.farmerId);
        }
        break;
      default:
        // Transporter (and any future role) only see orders they're linked to
        // via a shipment; until that join exists, scope to nothing.
        filter._id = { $in: [] };
    }
    return filter;
  }

  /** Loads an order the user is allowed to see, or throws 404/403. */
  private async getVisibleOrder(
    id: string,
    user: RequestUser,
  ): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Order not found');
    }
    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const isOwner =
      order.buyerId.toHexString() === user.id ||
      order.farmerId.toHexString() === user.id;
    if (user.role !== UserRole.Admin && !isOwner) {
      throw new ForbiddenException('You do not have access to this order');
    }
    return order;
  }

  private toResponse(order: OrderDocument): OrderResponseDto {
    return {
      id: order.id as string,
      buyerId: order.buyerId.toHexString(),
      farmerId: order.farmerId.toHexString(),
      items: order.items.map((i) => ({
        productId: i.productId.toHexString(),
        farmerId: i.farmerId.toHexString(),
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        subtotal: i.subtotal,
      })),
      totalAmount: order.totalAmount,
      platformFeePercent: order.platformFeePercent,
      platformFeeAmount: order.platformFeeAmount,
      grandTotal: order.grandTotal,
      shippingAddress: {
        street: order.shippingAddress.street ?? '',
        city: order.shippingAddress.city ?? '',
        province: order.shippingAddress.province ?? '',
        zip: order.shippingAddress.zip,
      },
      status: order.status,
      paymentId: order.paymentId?.toHexString(),
      shipmentId: order.shipmentId?.toHexString(),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
