import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { RequestUser } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import { PaymentGateway, PaymentStatus } from './schemas/payment.schema';
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
 * NOTE: returns DTO-shaped MOCK data. Real implementation (Sprint 3) integrates
 * JazzCash/Stripe behind a gateway abstraction, records the payment on the
 * blockchain asynchronously on success (§6.4) and emits notifications (§6.5).
 * `gatewayRef` is never returned to clients (§6.6).
 */
@Injectable()
export class PaymentService {
  initiate(buyerId: string, dto: CreatePaymentDto): InitiatePaymentResponseDto {
    const payment = this.samplePayment({
      id: new Types.ObjectId().toHexString(),
      orderId: dto.orderId,
      buyerId,
      gateway: dto.gateway,
      status: PaymentStatus.Pending,
    });

    return dto.gateway === PaymentGateway.Stripe
      ? { payment, clientSecret: 'pi_3Q_mock_secret_abc' }
      : {
          payment,
          redirectUrl: `https://sandbox.jazzcash.com.pk/pay/${payment.id}`,
        };
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
}
