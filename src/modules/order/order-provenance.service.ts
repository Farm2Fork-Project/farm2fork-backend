import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as QRCode from 'qrcode';
import { RequestUser } from '../../common/guards/roles.guard';
import { buildProductTraceUrl } from '../marketplace/marketplace.service';
import {
  Payment,
  PaymentDocument,
  PaymentStatus,
} from '../payment/schemas/payment.schema';
import { OrderService } from './order.service';
import { Order, OrderDocument, OrderStatus } from './schemas/order.schema';
import { OrderQrResponseDto } from './dto/order-qr-response.dto';

@Injectable()
export class OrderProvenanceService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Payment.name)
    private readonly payments: Model<PaymentDocument>,
    private readonly orderService: OrderService,
    private readonly config: ConfigService,
  ) {}

  async getSettledOrder(
    id: string,
  ): Promise<{ order: OrderDocument; paidAt: Date }> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Order not found');
    const order = await this.orders.findById(id).exec();
    if (
      !order?.paymentId ||
      ![
        OrderStatus.Paid,
        OrderStatus.Processing,
        OrderStatus.Shipped,
        OrderStatus.Delivered,
      ].includes(order.status)
    )
      throw new NotFoundException('Order not found');
    const payment = await this.payments
      .findOne({ _id: order.paymentId, orderId: order._id })
      .exec();
    // Refunded orders lose public access; an old QR resolves to 404 as well.
    if (
      payment?.status !== PaymentStatus.Success ||
      !payment.paidAt ||
      !Number.isFinite(payment.paidAt.getTime())
    ) {
      throw new NotFoundException('Order not found');
    }
    return { order, paidAt: payment.paidAt };
  }

  async getQr(id: string, user: RequestUser): Promise<OrderQrResponseDto> {
    await this.orderService.findOne(id, user);
    const { order } = await this.getSettledOrder(id);
    const qrCode = buildProductTraceUrl(
      this.config,
      `orders/${order._id.toHexString()}`,
    );
    try {
      if (new URL(qrCode).protocol !== 'https:')
        throw new Error('HTTPS required');
    } catch {
      throw new ServiceUnavailableException(
        'Set PUBLIC_TRACE_ORIGIN to a phone-accessible HTTPS web origin for order QR codes',
      );
    }
    const qrImageDataUri = await QRCode.toDataURL(qrCode, {
      errorCorrectionLevel: 'M',
      margin: 4,
    });
    return { orderId: order._id.toHexString(), qrCode, qrImageDataUri };
  }
}
