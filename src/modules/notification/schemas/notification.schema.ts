import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  OrderPlaced = 'order_placed',
  PaymentConfirmed = 'payment_confirmed',
  ShipmentAssigned = 'shipment_assigned',
  DeliveryUpdate = 'delivery_update',
  LoanUpdate = 'loan_update',
  AdminAction = 'admin_action',
}

/**
 * notifications (Collection 5.15).
 * Immutable record - createdAt only, no updatedAt (isRead is the only mutable
 * state and is updated in place).
 */
@Schema({
  collection: 'notifications',
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class Notification {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: NotificationType })
  type!: NotificationType;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  /** Polymorphic ref - Order | Shipment | LoanApplication etc. */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  relatedEntityId?: Types.ObjectId;

  @Prop()
  relatedEntityModel?: string;

  @Prop({ default: false })
  isRead!: boolean;

  createdAt!: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Critical index (master context 5.18).
NotificationSchema.index({ userId: 1, isRead: 1 });
