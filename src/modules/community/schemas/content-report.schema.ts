import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ContentReportDocument = HydratedDocument<ContentReport>;

export enum ReportTarget {
  Post = 'post',
  Comment = 'comment',
  Review = 'review',
}

export enum ReportReason {
  Spam = 'spam',
  Abuse = 'abuse',
  Misinformation = 'misinformation',
  Scam = 'scam',
  Other = 'other',
}

export enum ReportStatus {
  Open = 'open',
  /** An admin hid the content. */
  Actioned = 'actioned',
  /** An admin looked and left the content up. */
  Dismissed = 'dismissed',
}

/**
 * content_reports: a member flags a post, comment or review for the admin
 * team. One report per member per item; the admin queue groups by item.
 */
@Schema({ collection: 'content_reports', timestamps: true })
export class ContentReport {
  @Prop({ required: true, type: String, enum: ReportTarget })
  targetType!: ReportTarget;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporterId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: ReportReason })
  reason!: ReportReason;

  @Prop({ trim: true, maxlength: 500 })
  note?: string;

  @Prop({
    required: true,
    type: String,
    enum: ReportStatus,
    default: ReportStatus.Open,
  })
  status!: ReportStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  resolvedBy?: Types.ObjectId;

  @Prop()
  resolvedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ContentReportSchema = SchemaFactory.createForClass(ContentReport);
ContentReportSchema.index(
  { targetType: 1, targetId: 1, reporterId: 1 },
  { unique: true },
);
ContentReportSchema.index({ status: 1, createdAt: -1 });
