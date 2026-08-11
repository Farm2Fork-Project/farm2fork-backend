import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Connection, Model, Types } from 'mongoose';
import {
  BlockchainReferenceModel,
  BlockchainTransaction,
  BlockchainTransactionDocument,
  BlockchainTxStatus,
  BlockchainTxType,
} from '../blockchain/schemas/blockchain-transaction.schema';
import { RequestUser } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  Product,
  ProductDocument,
  ProductStatus,
} from '../marketplace/schemas/product.schema';
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
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(BlockchainTransaction.name)
    private readonly blockchainModel: Model<BlockchainTransactionDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly config: ConfigService,
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

  async simulate(
    id: string,
    buyerId: string,
    status: PaymentStatus,
  ): Promise<PaymentResponseDto> {
    if (
      this.config.get<boolean>('PAYMENT_SIMULATOR_ENABLED') !== true ||
      this.config.get<string>('NODE_ENV') === 'production'
    ) {
      throw new NotFoundException('Payment simulator is not enabled');
    }

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const payment = await this.paymentModel
          .findOne({ _id: id, buyerId: new Types.ObjectId(buyerId) })
          .session(session)
          .exec();
        if (!payment) throw new NotFoundException('Payment not found');
        if (payment.status === PaymentStatus.Success) {
          return this.toResponse(payment);
        }
        if (payment.status !== PaymentStatus.Pending) {
          throw new BadRequestException('Payment cannot be settled');
        }
        if (status === PaymentStatus.Failed) {
          payment.status = PaymentStatus.Failed;
          payment.failedAt = new Date();
          await payment.save({ session });
          return this.toResponse(payment);
        }
        if (status !== PaymentStatus.Success) {
          throw new BadRequestException('Unsupported payment outcome');
        }

        const order = await this.orderModel
          .findById(payment.orderId)
          .session(session)
          .exec();
        if (!order || order.status !== OrderStatus.Pending) {
          throw new BadRequestException('Only pending orders can be settled');
        }

        for (const item of order.items) {
          const update = await this.productModel
            .updateOne(
              { _id: item.productId, quantity: { $gte: item.quantity } },
              { $inc: { quantity: -item.quantity } },
              { session },
            )
            .exec();
          if (update.modifiedCount !== 1) {
            throw new BadRequestException('Insufficient stock to settle order');
          }
          await this.productModel
            .updateOne(
              { _id: item.productId, quantity: 0 },
              { $set: { status: ProductStatus.SoldOut } },
              { session },
            )
            .exec();
        }

        const [blockchainRecord] = await this.blockchainModel.create(
          [
            {
              type: BlockchainTxType.Payment,
              referenceId: payment._id,
              referenceModel: BlockchainReferenceModel.Payment,
              payload: {
                payment: {
                  orderId: order._id,
                  buyerId: order.buyerId,
                  farmerId: order.farmerId,
                  amount: payment.amount,
                  currency: payment.currency,
                  gateway: payment.gateway,
                  paidAt: new Date(),
                },
                supplyChain: null,
              },
              status: BlockchainTxStatus.Pending,
            },
          ],
          { session },
        );

        payment.status = PaymentStatus.Success;
        payment.paidAt = new Date();
        payment.blockchainTxId = blockchainRecord._id;
        order.status = OrderStatus.Paid;
        order.paymentId = payment._id;
        await Promise.all([payment.save({ session }), order.save({ session })]);
        return this.toResponse(payment);
      });
    } finally {
      await session.endSession();
    }
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
    void gateway;
    void dto;
    throw new NotImplementedException(
      'Gateway webhook signature verification is not implemented',
    );
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
