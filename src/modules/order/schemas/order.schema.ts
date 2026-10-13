import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { GeoPoint, GeoPointSchema } from '../../../common/geo/geo-point.schema';

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

  /** Buyer's drop-off pin (required for new orders; absent on legacy ones). */
  @Prop()
  lat?: number;

  @Prop()
  lng?: number;
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

  /**
   * Fixed delivery price quoted at checkout (owner-approved extension of
   * master context 6.2): base + per-km x estimated road distance.
   * 0 on orders created before delivery pricing existed.
   */
  @Prop({ min: 0, default: 0 })
  deliveryFee!: number;

  /** Estimated road distance farm -> drop-off used for deliveryFee. */
  @Prop({ min: 0 })
  deliveryDistanceKm?: number;

  /** totalAmount + platformFeeAmount + deliveryFee. */
  @Prop({ required: true, min: 0 })
  grandTotal!: number;

  /** Farm pin snapshot at order time; transporters are matched against it. */
  @Prop({ type: GeoPointSchema })
  pickupLocation?: GeoPoint;

  /** Transporters who declined this delivery offer. */
  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'User' }],
    default: [],
  })
  declinedBy!: Types.ObjectId[];

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
// Public provenance reads find the paid orders that contain a product.
OrderSchema.index({ 'items.productId': 1 });
// Delivery offers: paid, unclaimed orders near a transporter.
OrderSchema.index({ pickupLocation: '2dsphere' });
