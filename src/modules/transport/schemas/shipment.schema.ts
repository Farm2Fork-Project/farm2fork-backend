import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ShipmentDocument = HydratedDocument<Shipment>;

export enum ShipmentStatus {
  Assigned = 'assigned',
  PickedUp = 'picked_up',
  InTransit = 'in_transit',
  Delivered = 'delivered',
  Failed = 'failed',
}

@Schema({ _id: false })
export class ShipmentAddress {
  @Prop()
  street?: string;

  @Prop()
  city?: string;

  @Prop()
  province?: string;

  @Prop()
  zip?: string;

  /** Map pin, for navigation once the delivery is accepted. */
  @Prop()
  lat?: number;

  @Prop()
  lng?: number;
}
const ShipmentAddressSchema = SchemaFactory.createForClass(ShipmentAddress);

/**
 * Each status change appends one entry (master context 17.5). The timeline UI
 * is built from this array, never from hardcoded steps.
 */
@Schema({ _id: false })
export class ShipmentStatusHistoryEntry {
  @Prop({ required: true, type: String, enum: ShipmentStatus })
  status!: ShipmentStatus;

  @Prop({ required: true })
  timestamp!: Date;

  @Prop()
  note?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}
const ShipmentStatusHistoryEntrySchema = SchemaFactory.createForClass(
  ShipmentStatusHistoryEntry,
);

@Schema({ _id: false })
export class DeliveryIssue {
  @Prop({ required: true }) reason!: string;
  @Prop() note?: string;
  @Prop({ required: true, type: String, enum: ShipmentStatus })
  stage!: ShipmentStatus;
  @Prop({ required: true }) reportedAt!: Date;
  @Prop() resolvedAt?: Date;
  @Prop() resolution?: string;
}
const DeliveryIssueSchema = SchemaFactory.createForClass(DeliveryIssue);
@Schema({ _id: false })
export class DeliveryAssignment {
  @Prop({ type: MongooseSchema.Types.ObjectId })
  fromTransporterId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  transporterId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  assignedBy!: Types.ObjectId;
  @Prop({ required: true }) reason!: string;
  @Prop({ required: true }) timestamp!: Date;
}
const DeliveryAssignmentSchema =
  SchemaFactory.createForClass(DeliveryAssignment);

@Schema({
  collection: 'shipments',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class Shipment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true,
    index: true,
  })
  orderId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  transporterId?: Types.ObjectId;

  @Prop({
    required: true,
    type: String,
    enum: ShipmentStatus,
    default: ShipmentStatus.Assigned,
  })
  status!: ShipmentStatus;

  /** Farmer's farm location. */
  @Prop({ type: ShipmentAddressSchema })
  pickupAddress?: ShipmentAddress;

  /** Copied from order shippingAddress. */
  @Prop({ type: ShipmentAddressSchema })
  deliveryAddress?: ShipmentAddress;

  @Prop({ type: [ShipmentStatusHistoryEntrySchema], default: [] })
  statusHistory!: ShipmentStatusHistoryEntry[];

  @Prop()
  /** Delivery fee snapshot from the order: what the transporter earns. */
  @Prop({ min: 0 })
  deliveryFee?: number;

  estimatedDelivery?: Date;

  @Prop()
  actualDelivery?: Date;

  @Prop({ select: false }) proofNonce?: string;
  @Prop({ default: 0, select: false }) proofFailures!: number;
  @Prop({ select: false }) proofBlockedUntil?: Date;
  @Prop({ type: DeliveryIssueSchema }) issue?: DeliveryIssue;
  @Prop({ type: [DeliveryAssignmentSchema], default: [] })
  assignmentHistory!: DeliveryAssignment[];
  createdAt!: Date;
  updatedAt!: Date;
}

export const ShipmentSchema = SchemaFactory.createForClass(Shipment);
