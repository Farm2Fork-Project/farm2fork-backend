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
import { Connection, FilterQuery, Model, Types } from 'mongoose';
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

  async findAll(
    user: RequestUser,
    query: QueryPaymentDto,
  ): Promise<PaymentListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.scopeFilter(user, query);
    const [payments, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.paymentModel.countDocuments(filter).exec(),
    ]);

    return {
      data: payments.map((payment) => this.toResponse(payment)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  }

  async findOne(
    id: string,
    user: RequestUser,
  ): Promise<PaymentResponseDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Payment not found');
    }
    const payment = await this.paymentModel.findById(id).exec();
    if (!payment) throw new NotFoundException('Payment not found');
    if (
      user.role !== UserRole.Admin &&
      payment.buyerId.toHexString() !== user.id
    ) {
      throw new ForbiddenException('You do not have access to this payment');
    }
    return this.toResponse(payment);
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

  async refund(id: string): Promise<PaymentResponseDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Payment not found');
    }
    const payment = await this.paymentModel.findById(id).exec();
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === PaymentStatus.Refunded) {
      return this.toResponse(payment);
    }
    if (payment.status !== PaymentStatus.Success) {
      throw new BadRequestException('Only successful payments can be refunded');
    }

    payment.status = PaymentStatus.Refunded;
    payment.refundedAt = new Date();
    await payment.save();
    return this.toResponse(payment);
  }

  // --- internals -------------------------------------------------------------

  private scopeFilter(
    user: RequestUser,
    query: QueryPaymentDto,
  ): FilterQuery<PaymentDocument> {
    const filter: FilterQuery<PaymentDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.gateway) filter.gateway = query.gateway;
    if (user.role === UserRole.Buyer) {
      filter.buyerId = new Types.ObjectId(user.id);
    } else if (user.role !== UserRole.Admin) {
      filter._id = { $in: [] };
    }
    return filter;
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
