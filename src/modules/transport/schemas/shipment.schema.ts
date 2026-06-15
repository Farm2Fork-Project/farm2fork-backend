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
  estimatedDelivery?: Date;

  @Prop()
  actualDelivery?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ShipmentSchema = SchemaFactory.createForClass(Shipment);
