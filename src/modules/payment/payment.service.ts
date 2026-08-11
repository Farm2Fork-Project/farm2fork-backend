import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { RequestUser } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import { Order, OrderDocument, OrderStatus } from '../order/schemas/order.schema';
import {
  Payment,
  PaymentDocument,
  PaymentGateway,
  PaymentStatus,
} from './schemas/payment.schema';
import {
  CreatePaymentDto,
  InitiatePaymentResponseDto,
  PaymentListResponseDto,
  PaymentResponseDto,
  PaymentWebhookDto,
  QueryPaymentDto,
} from './dto';

/**
 * PaymentService (EP-04).
 *
 * Payment initiation is persisted and always derives its amount from the order.
 * Gateway settlement, blockchain recording, and notifications are added in
 * subsequent payment-slice steps. `gatewayRef` never reaches client DTOs.
 */
@Injectable()
export class PaymentService {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
  ) {}

  async initiate(
    buyerId: string,
    dto: CreatePaymentDto,
  ): Promise<InitiatePaymentResponseDto> {
    const order = await this.orderModel.findById(dto.orderId).exec();
    if (!order) throw new NotFoundException('Order not found');
    if (order.buyerId.toHexString() !== buyerId) {
      throw new ForbiddenException('You can only pay for your own order');
    }
    if (order.status !== OrderStatus.Pending) {
      throw new BadRequestException('Only pending orders can be paid');
    }

    const existing = await this.paymentModel
      .findOne({ orderId: order._id })
      .exec();
    if (existing?.status === PaymentStatus.Pending) {
      return { payment: this.toResponse(existing) };
    }
    if (existing) {
      existing.status = PaymentStatus.Pending;
      existing.gateway = dto.gateway;
      existing.gatewayRef = randomUUID();
      existing.failedAt = undefined;
      await existing.save();
      return { payment: this.toResponse(existing) };
    }

    const payment = await this.paymentModel.create({
      orderId: order._id,
      buyerId: order.buyerId,
      amount: order.grandTotal,
      currency: 'PKR',
      gateway: dto.gateway,
      gatewayRef: randomUUID(),
      status: PaymentStatus.Pending,
    });
    return { payment: this.toResponse(payment) };
  }

  findAll(user: RequestUser, query: QueryPaymentDto): PaymentListResponseDto {
    const scoped = this.sampleCatalog().map((p) =>
      user.role === UserRole.Admin ? p : { ...p, buyerId: user.id },
    );
    const filtered = scoped.filter(
      (p) =>
        (!query.status || p.status === query.status) &&
        (!query.gateway || p.gateway === query.gateway),
    );
    return this.paginate(query, filtered);
  }

  findOne(id: string, user: RequestUser): PaymentResponseDto {
    const payment = this.samplePayment({ id });
    if (user.role !== UserRole.Admin) payment.buyerId = user.id;
    return payment;
  }

  /** Gateway callback - flips the payment to success/failed. */
  handleWebhook(
    gateway: PaymentGateway,
    dto: PaymentWebhookDto,
  ): { received: boolean; gateway: PaymentGateway; status: string } {
    return { received: true, gateway, status: dto.status };
  }

  refund(id: string): PaymentResponseDto {
    return this.samplePayment({
      id,
      status: PaymentStatus.Refunded,
      refundedAt: new Date().toISOString(),
    });
  }

  // --- mock helpers ----------------------------------------------------------

  private paginate(
    query: QueryPaymentDto,
    catalog: PaymentResponseDto[],
  ): PaymentListResponseDto {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const total = 8;
    return {
      data: catalog.slice(0, limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private sampleCatalog(): PaymentResponseDto[] {
    return [
      this.samplePayment({}),
      this.samplePayment({
        id: '6a2fe77bb77795516febc601',
        status: PaymentStatus.Success,
        gateway: PaymentGateway.Stripe,
        paidAt: '2026-06-15T12:10:00.000Z',
        blockchainTxId: '6a2fe77bb77795516febc999',
      }),
    ];
  }

  private samplePayment(
    overrides: Partial<PaymentResponseDto> = {},
  ): PaymentResponseDto {
    const now = new Date().toISOString();
    const base: PaymentResponseDto = {
      id: '6a2fe77bb77795516febc600',
      orderId: '6a2fe77bb77795516febc500',
      buyerId: '6a2fe77bb77795516febc222',
      amount: 1260,
      currency: 'PKR',
      gateway: PaymentGateway.JazzCash,
      status: PaymentStatus.Pending,
      createdAt: now,
      updatedAt: now,
    };
    return { ...base, ...overrides };
  }

  private toResponse(payment: PaymentDocument): PaymentResponseDto {
    return {
      id: payment.id,
      orderId: payment.orderId.toHexString(),
      buyerId: payment.buyerId.toHexString(),
      amount: payment.amount,
      currency: payment.currency,
      gateway: payment.gateway,
      status: payment.status,
      blockchainTxId: payment.blockchainTxId?.toHexString(),
      paidAt: payment.paidAt?.toISOString(),
      failedAt: payment.failedAt?.toISOString(),
      refundedAt: payment.refundedAt?.toISOString(),
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}
