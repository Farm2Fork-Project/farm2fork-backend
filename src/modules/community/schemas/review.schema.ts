import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ReviewDocument = HydratedDocument<Review>;

export enum ReviewStatus {
  Published = 'published',
  Removed = 'removed',
}

/**
 * reviews: a buyer rates the farmer after a delivered order. One review per
 * order, so every rating is tied to a real, completed purchase.
 */
@Schema({ collection: 'reviews', timestamps: true })
export class Review {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Order',
    required: true,
    unique: true,
  })
  orderId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  buyerId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  farmerId!: Types.ObjectId;

  /** Snapshot of what was bought, shown next to the review. */
  @Prop({ type: [String], default: [] })
  productNames!: string[];

  @Prop({ required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ trim: true, maxlength: 1000 })
  comment?: string;

  /** The farmer's single public reply. */
  @Prop({ trim: true, maxlength: 1000 })
  farmerReply?: string;

  @Prop()
  farmerRepliedAt?: Date;

  @Prop({
    required: true,
    type: String,
    enum: ReviewStatus,
    default: ReviewStatus.Published,
  })
  status!: ReviewStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ farmerId: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ buyerId: 1, createdAt: -1 });
