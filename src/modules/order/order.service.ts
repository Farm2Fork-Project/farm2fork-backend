import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { RequestUser } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import { OrderStatus } from './schemas/order.schema';
import {
  CreateOrderDto,
  OrderListResponseDto,
  OrderResponseDto,
  QueryOrderDto,
} from './dto';

const MOCK_PLATFORM_FEE_PERCENT = 5; // real value comes from ConfigService (§6.2)

/**
 * OrderService (EP-04).
 *
 * NOTE: returns DTO-shaped MOCK data. Real implementation (Sprint 3) will
 * enforce the One-Order-One-Farmer rule (§6.1), snapshot product prices, read
 * the platform fee via ConfigService (§6.2) and persist via Mongoose.
 */
@Injectable()
export class OrderService {
  create(buyerId: string, dto: CreateOrderDto): OrderResponseDto {
    const farmerId = '6a2fe77bb77795516febc111';
    const items = dto.items.map((item) => {
      const unitPrice = 120;
      return {
        productId: item.productId,
        farmerId,
        productName: 'Roma Tomatoes',
        quantity: item.quantity,
        unitPrice,
        subtotal: unitPrice * item.quantity,
      };
    });
    const totalAmount = items.reduce((sum, i) => sum + i.subtotal, 0);
    const platformFeeAmount = (totalAmount * MOCK_PLATFORM_FEE_PERCENT) / 100;

    return this.sampleOrder({
      id: new Types.ObjectId().toHexString(),
      buyerId,
      farmerId,
      items,
      totalAmount,
      platformFeePercent: MOCK_PLATFORM_FEE_PERCENT,
      platformFeeAmount,
      grandTotal: totalAmount + platformFeeAmount,
      shippingAddress: dto.shippingAddress,
      status: OrderStatus.Pending,
    });
  }

  findAll(user: RequestUser, query: QueryOrderDto): OrderListResponseDto {
    // Non-admins are scoped to their own orders; admins see everything.
    const scoped = this.sampleCatalog().map((order) =>
      user.role === UserRole.Buyer
        ? { ...order, buyerId: user.id }
        : user.role === UserRole.Farmer
          ? { ...order, farmerId: user.id }
          : order,
    );
    const filtered = query.status
      ? scoped.filter((o) => o.status === query.status)
      : scoped;
    return this.paginate(query, filtered);
  }

  findOne(id: string, user: RequestUser): OrderResponseDto {
    const order = this.sampleOrder({ id });
    if (user.role === UserRole.Buyer) order.buyerId = user.id;
    if (user.role === UserRole.Farmer) order.farmerId = user.id;
    return order;
  }

  cancel(id: string, user: RequestUser): OrderResponseDto {
    return this.sampleOrder({
      id,
      buyerId: user.id,
      status: OrderStatus.Cancelled,
      updatedAt: new Date().toISOString(),
    });
  }

  // --- mock helpers ----------------------------------------------------------

  private paginate(
    query: QueryOrderDto,
    catalog: OrderResponseDto[],
  ): OrderListResponseDto {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const total = 12;
    return {
      data: catalog.slice(0, limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private sampleCatalog(): OrderResponseDto[] {
    return [
      this.sampleOrder({}),
      this.sampleOrder({
        id: '6a2fe77bb77795516febc501',
        status: OrderStatus.Paid,
        paymentId: '6a2fe77bb77795516febc600',
      }),
    ];
  }

  private sampleOrder(
    overrides: Partial<OrderResponseDto> = {},
  ): OrderResponseDto {
    const now = new Date().toISOString();
    const base: OrderResponseDto = {
      id: '6a2fe77bb77795516febc500',
      buyerId: '6a2fe77bb77795516febc222',
      farmerId: '6a2fe77bb77795516febc111',
      items: [
        {
          productId: '6a2fe77bb77795516febc287',
          farmerId: '6a2fe77bb77795516febc111',
          productName: 'Roma Tomatoes',
          quantity: 10,
          unitPrice: 120,
          subtotal: 1200,
        },
      ],
      totalAmount: 1200,
      platformFeePercent: MOCK_PLATFORM_FEE_PERCENT,
      platformFeeAmount: 60,
      grandTotal: 1260,
      shippingAddress: {
        street: '12 Mall Road',
        city: 'Lahore',
        province: 'Punjab',
        zip: '54000',
      },
      status: OrderStatus.Pending,
      createdAt: now,
      updatedAt: now,
    };
    return { ...base, ...overrides };
  }
}
