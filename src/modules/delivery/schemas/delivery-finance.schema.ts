import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
export type DeliveryEarningDocument = HydratedDocument<DeliveryEarning>;
@Schema({
  collection: 'delivery_earnings',
  timestamps: { createdAt: true, updatedAt: false },
})
export class DeliveryEarning {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, unique: true })
  shipmentId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  orderId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  transporterId!: Types.ObjectId;
  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  amountMinor!: number;
  @Prop({ type: MongooseSchema.Types.ObjectId }) payoutId?: Types.ObjectId;
  @Prop({ required: true }) earnedAt!: Date;
  createdAt!: Date;
}
export const DeliveryEarningSchema =
  SchemaFactory.createForClass(DeliveryEarning);
DeliveryEarningSchema.index({ transporterId: 1, earnedAt: -1 });
export type DeliveryPayoutDocument = HydratedDocument<DeliveryPayout>;
@Schema({
  collection: 'delivery_payouts',
  timestamps: { createdAt: true, updatedAt: false },
})
export class DeliveryPayout {
  @Prop({ required: true, unique: true }) requestId!: string;
  @Prop({ required: true, select: false }) fingerprint!: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  transporterId!: Types.ObjectId;
  @Prop({ type: [MongooseSchema.Types.ObjectId], required: true })
  earningIds!: Types.ObjectId[];
  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  amountMinor!: number;
  @Prop({ required: true }) paidAt!: Date;
  @Prop({ required: true }) reference!: string;
  @Prop({ required: true }) reason!: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  recordedBy!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId })
  reversesPayoutId?: Types.ObjectId;
  createdAt!: Date;
}
export const DeliveryPayoutSchema =
  SchemaFactory.createForClass(DeliveryPayout);
DeliveryPayoutSchema.index(
  { reversesPayoutId: 1 },
  { unique: true, sparse: true },
);
export type ManualRefundDocument = HydratedDocument<ManualRefund>;
@Schema({
  collection: 'manual_refunds',
  timestamps: { createdAt: true, updatedAt: false },
})
export class ManualRefund {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, unique: true })
  orderId!: Types.ObjectId;
  @Prop({ required: true, unique: true }) requestId!: string;
  @Prop({ required: true, select: false }) fingerprint!: string;
  @Prop({ required: true, min: 0, validate: Number.isSafeInteger })
  amountMinor!: number;
  @Prop({ required: true }) reference!: string;
  @Prop({ required: true }) reason!: string;
  @Prop({ required: true }) paidAt!: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  recordedBy!: Types.ObjectId;
  createdAt!: Date;
}
export const ManualRefundSchema = SchemaFactory.createForClass(ManualRefund);
