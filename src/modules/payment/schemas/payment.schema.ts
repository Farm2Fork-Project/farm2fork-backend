import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type PaymentDocument = HydratedDocument<Payment>;

export enum PaymentGateway {
  JazzCash = 'jazzcash',
  Stripe = 'stripe',
}

export enum PaymentStatus {
  Pending = 'pending',
  Success = 'success',
  Failed = 'failed',
  Refunded = 'refunded',
}

@Schema({
  collection: 'payments',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      // gatewayRef (master context 6.6) - never expose to non-admin clients.
      delete ret.gatewayRef;
      delete ret.__v;
      return ret;
    },
  },
})
export class Payment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true,
    index: true,
  })
  orderId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  buyerId!: Types.ObjectId;

  /** grandTotal from order. */
  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ default: 'PKR' })
  currency!: string;

  @Prop({ required: true, type: String, enum: PaymentGateway })
  gateway!: PaymentGateway;

  /** gatewayRef (master context 6.6) - sensitive, select: false. */
  @Prop({ select: false })
  gatewayRef?: string;

  @Prop({
    required: true,
    type: String,
    enum: PaymentStatus,
    default: PaymentStatus.Pending,
  })
  status!: PaymentStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BlockchainTransaction' })
  blockchainTxId?: Types.ObjectId;

  @Prop()
  paidAt?: Date;

  @Prop()
  failedAt?: Date;

  @Prop()
  refundedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
