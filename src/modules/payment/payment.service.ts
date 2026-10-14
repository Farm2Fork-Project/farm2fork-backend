import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { ClientSession, Connection, FilterQuery, Model, Types } from 'mongoose';
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
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../order/schemas/order.schema';
import { TransportService } from '../transport/transport.service';
import { SafepayClient } from './safepay/safepay.client';
import {
  Payment,
  PaymentDocument,
  PaymentGateway,
  PaymentStatus,
} from './schemas/payment.schema';
import {
  CreatePaymentDto,
  PaymentClient,
  InitiatePaymentResponseDto,
  PaymentListResponseDto,
  PaymentResponseDto,
  QueryPaymentDto,
} from './dto';

type SettlementStatus = PaymentStatus.Success | PaymentStatus.Failed;

/**
 * PaymentService (EP-04).
 *
 * Payment initiation is persisted and always derives its amount from the order.
 * Gateway settlement, blockchain recording, and notifications are added in
 * subsequent payment-slice steps. `gatewayRef` never reaches client DTOs.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

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
    private readonly notifications: NotificationService,
    private readonly transport: TransportService,
    private readonly safepayClient: SafepayClient,
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

    // Close draft cancellation before contacting the gateway. The conditional
    // write shares the order document with cancellation, making the race atomic.
    const claimed = await this.orderModel
      .updateOne(
        { _id: order._id, status: OrderStatus.Pending },
        { $set: { paymentStartedAt: new Date() } },
      )
      .exec();
    if (claimed.matchedCount !== 1)
      throw new BadRequestException(
        'This order is no longer available for payment. Refresh its status.',
      );

    const existing = await this.paymentModel
      .findOne({ orderId: order._id })
      .exec();
    // Non-Safepay gateways keep the original idempotent short-circuit - the
    // mock gatewayRef never expires. Safepay's tracker+checkout URL are
    // re-issued on every call so a buyer who navigated away can always
    // resume, even while a payment for this order is still Pending.
    if (
      existing?.status === PaymentStatus.Pending &&
      existing.gateway === dto.gateway &&
      dto.gateway !== PaymentGateway.Safepay
    ) {
      return { payment: this.toResponse(existing) };
    }

    const { gatewayRef, checkoutUrl } = await this.beginGatewayPayment(
      dto.gateway,
      order,
      dto.client === PaymentClient.Mobile,
    );

    if (existing) {
      existing.status = PaymentStatus.Pending;
      existing.gateway = dto.gateway;
      existing.gatewayRef = gatewayRef;
      existing.failedAt = undefined;
      await existing.save();
      return { payment: this.toResponse(existing), checkoutUrl };
    }

    const payment = await this.paymentModel.create({
      orderId: order._id,
      buyerId: order.buyerId,
      amount: order.grandTotal,
      currency: 'PKR',
      gateway: dto.gateway,
      gatewayRef,
      status: PaymentStatus.Pending,
    });
    return { payment: this.toResponse(payment), checkoutUrl };
  }

  /** Starts the gateway-side session. Mock gateways just mint a local ref. */
  private async beginGatewayPayment(
    gateway: PaymentGateway,
    order: OrderDocument,
    mobile = false,
  ): Promise<{ gatewayRef: string; checkoutUrl?: string }> {
    if (gateway !== PaymentGateway.Safepay) {
      return { gatewayRef: randomUUID() };
    }

    const orderId = order._id.toHexString();
    const tracker = await this.safepayClient.createTracker({
      amount: order.grandTotal,
      currency: 'PKR',
      orderId,
    });
    const authToken = await this.safepayClient.getAuthToken();
    const checkoutUrl = this.safepayClient.buildCheckoutUrl({
      trackerToken: tracker.token,
      authToken,
      redirectUrl: this.returnUrl('safepay.redirectUrl', orderId, mobile),
      cancelUrl: this.returnUrl('safepay.cancelUrl', orderId, mobile),
    });
    return { gatewayRef: tracker.token, checkoutUrl };
  }

  private returnUrl(key: string, orderId: string, mobile: boolean): string {
    const configured = this.config.getOrThrow<string>(key);
    if (!mobile) return configured;
    const url = new URL(configured);
    url.searchParams.set('mobileOrderId', orderId);
    return url.toString();
  }

  async simulate(
    id: string,
    buyerId: string,
    status: SettlementStatus,
  ): Promise<PaymentResponseDto> {
    if (
      this.config.get<boolean>('PAYMENT_SIMULATOR_ENABLED') !== true ||
      this.config.get<string>('NODE_ENV') === 'production'
    ) {
      throw new NotFoundException('Payment simulator is not enabled');
    }

    return this.settle(
      { _id: id, buyerId: new Types.ObjectId(buyerId) },
      status,
    );
  }

  /**
   * Shared settlement transition, used by both the local simulator and the
   * Safepay webhook. `filter` scopes which payment is being settled - the
   * simulator scopes to the calling buyer, the webhook scopes to the
   * gateway's own reference since there is no authenticated buyer there.
   */
  private async settle(
    filter: FilterQuery<PaymentDocument>,
    status: SettlementStatus,
  ): Promise<PaymentResponseDto> {
    const session = await this.connection.startSession();
    let settledOrder: OrderDocument | undefined;
    let response: PaymentResponseDto;
    try {
      response = await session.withTransaction(async () => {
        const payment = await this.paymentModel
          .findOne(filter)
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

        const order = await this.orderModel
          .findById(payment.orderId)
          .session(session)
          .exec();
        if (!order || order.status !== OrderStatus.Pending) {
          throw new BadRequestException('Only pending orders can be settled');
        }

        await this.decrementStock(order, session);

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
        settledOrder = order;
        return this.toResponse(payment);
      });
    } finally {
      await session.endSession();
    }
    if (settledOrder) this.afterPaymentSuccess(settledOrder);
    return response;
  }

  /**
   * Side effects of a settled payment, run after the transaction commits:
   * notify both parties (master context 6.5) and offer the delivery to
   * nearby transporters. Never fails the payment.
   */
  private afterPaymentSuccess(order: OrderDocument): void {
    const label = `#${order._id.toHexString().slice(-6).toUpperCase()}`;
    this.notifications.notifyInBackground({
      userIds: [order.buyerId],
      type: NotificationType.PaymentConfirmed,
      title: 'Payment confirmed',
      message: `We received Rs ${order.grandTotal.toLocaleString('en-PK')} for order ${label}. We're finding a transporter near the farm.`,
      relatedEntityId: order._id,
      relatedEntityModel: 'Order',
    });
    this.notifications.notifyInBackground({
      userIds: [order.farmerId],
      type: NotificationType.PaymentConfirmed,
      title: 'Order paid - prepare for pickup',
      message: `Order ${label} is paid. A nearby transporter will be assigned to collect it.`,
      relatedEntityId: order._id,
      relatedEntityModel: 'Order',
    });
    this.transport.dispatchInBackground(order._id);
  }

  private async decrementStock(
    order: OrderDocument,
    session: ClientSession,
  ): Promise<void> {
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

  async findOne(id: string, user: RequestUser): Promise<PaymentResponseDto> {
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
  async handleWebhook(
    gateway: PaymentGateway,
    body: Record<string, unknown>,
    signatureHeader: string | undefined,
    rawBody?: Buffer,
  ): Promise<{ received: boolean; gateway: PaymentGateway; status: string }> {
    if (gateway !== PaymentGateway.Safepay) {
      throw new NotImplementedException(
        'Gateway webhook signature verification is not implemented',
      );
    }

    const type = body.type;
    const data = body.data;
    if (typeof type !== 'string' || typeof data !== 'object' || data === null) {
      throw new BadRequestException('Malformed Safepay webhook payload');
    }
    if (
      !this.safepayClient.verifyWebhookSignature(data, signatureHeader, {
        body,
        rawBody,
      })
    ) {
      throw new ForbiddenException('Invalid Safepay webhook signature');
    }

    const outcome = this.mapSafepayEventType(type);
    if (!outcome) {
      // Event we don't act on (auth-only steps, subscriptions, voids, ...).
      // Still acknowledged so Safepay doesn't retry it.
      return { received: true, gateway, status: 'ignored' };
    }

    const trackerToken = this.extractSafepayTrackerToken(
      data as Record<string, unknown>,
    );
    if (!trackerToken) {
      this.logger.error(
        `Safepay webhook '${type}' had no recognizable tracker reference: ${JSON.stringify(data)}`,
      );
      throw new BadRequestException(
        'Safepay webhook payload is missing a tracker reference',
      );
    }

    const result = await this.settle({ gatewayRef: trackerToken }, outcome);
    return { received: true, gateway, status: result.status };
  }

  /**
   * Only `payment.succeeded`/`payment.failed` drive settlement. In
   * particular `authorization.succeeded` is deliberately excluded: our
   * tracker is created with mode "payment" (direct sale), and settling on
   * authorization alone would risk marking an order Paid before Safepay has
   * actually captured funds.
   */
  private mapSafepayEventType(type: string): SettlementStatus | null {
    switch (type) {
      case 'payment.succeeded':
        return PaymentStatus.Success;
      case 'payment.failed':
        return PaymentStatus.Failed;
      default:
        return null;
    }
  }

  /**
   * The exact field holding the tracker token inside a webhook's `data`
   * object isn't confirmed against a real payload yet (Safepay's docs didn't
   * expose one verbatim) - this checks every plausible shape and logs the
   * full payload above if none match, so the first real sandbox webhook
   * makes the correct field obvious.
   */
  private extractSafepayTrackerToken(
    data: Record<string, unknown>,
  ): string | undefined {
    if (typeof data.token === 'string') return data.token;
    if (typeof data.tracker === 'string') return data.tracker;
    if (typeof data.tracker_token === 'string') return data.tracker_token;
    if (data.tracker && typeof data.tracker === 'object') {
      const nested = (data.tracker as Record<string, unknown>).token;
      if (typeof nested === 'string') return nested;
    }
    return undefined;
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
