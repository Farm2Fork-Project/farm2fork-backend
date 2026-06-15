import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type OrderDocument = HydratedDocument<Order>;

export enum OrderStatus {
  Pending = 'pending',
  Paid = 'paid',
  Processing = 'processing',
  Shipped = 'shipped',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
}

/**
 * Embedded order item. productName and unitPrice are SNAPSHOTS taken at order
 * time so later product edits never mutate historical orders.
 * Every item.farmerId must equal the parent order.farmerId
 * (One-Order-One-Farmer rule, master context 6.1 - enforced in OrderService).
 */
@Schema({ _id: false })
export class OrderItem {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Product',
    required: true,
  })
  productId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  farmerId!: Types.ObjectId;

  @Prop({ required: true })
  productName!: string;

  @Prop({ required: true, min: 0 })
  quantity!: number;

  @Prop({ required: true, min: 0 })
  unitPrice!: number;

  @Prop({ required: true, min: 0 })
  subtotal!: number;
}
const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ _id: false })
export class ShippingAddress {
  @Prop()
  street?: string;

  @Prop()
  city?: string;

  @Prop()
  province?: string;

  @Prop()
  zip?: string;
}
const ShippingAddressSchema = SchemaFactory.createForClass(ShippingAddress);

@Schema({
  collection: 'orders',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class Order {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  buyerId!: Types.ObjectId;

  /** The single farmer for the entire order (One-Order-One-Farmer rule). */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  farmerId!: Types.ObjectId;

  @Prop({ type: [OrderItemSchema], required: true })
  items!: OrderItem[];

  @Prop({ required: true, min: 0 })
  totalAmount!: number;

  /** Snapshot of platform_fee_percent from system_config at order time. */
  @Prop({ required: true, min: 0 })
  platformFeePercent!: number;

  /** totalAmount * (platformFeePercent / 100). */
  @Prop({ required: true, min: 0 })
  platformFeeAmount!: number;

  /** totalAmount + platformFeeAmount. */
  @Prop({ required: true, min: 0 })
  grandTotal!: number;

  @Prop({ type: ShippingAddressSchema, required: true })
  shippingAddress!: ShippingAddress;

  @Prop({
    required: true,
    type: String,
    enum: OrderStatus,
    default: OrderStatus.Pending,
  })
  status!: OrderStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Payment' })
  paymentId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Shipment' })
  shipmentId?: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// Critical indexes (master context 5.18).
OrderSchema.index({ buyerId: 1, status: 1 });
OrderSchema.index({ farmerId: 1, status: 1 });
