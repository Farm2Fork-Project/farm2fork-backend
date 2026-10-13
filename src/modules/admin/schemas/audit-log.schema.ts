import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ _id: false })
export class AuditLogMetadata {
  @Prop({ type: MongooseSchema.Types.Mixed })
  before?: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed })
  after?: Record<string, unknown>;
}
const AuditLogMetadataSchema = SchemaFactory.createForClass(AuditLogMetadata);

/**
 * audit_logs (Collection 5.12).
 * Immutable - createdAt only, no updatedAt. Admin-only access. metadata.before
 * and metadata.after may contain sensitive state and must be sanitised before
 * being returned even to an admin (master context 6.6).
 */
@Schema({
  collection: 'audit_logs',
  timestamps: { createdAt: true, updatedAt: false },
})
export class AuditLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  actorId!: Types.ObjectId;

  /** Role at time of action. */
  @Prop({ required: true })
  actorRole!: string;

  /** Dot-notation, e.g. user.deactivated | product.deleted | loan.approved. */
  @Prop({ required: true })
  action!: string;

  /** e.g. 'User' | 'Product' | 'LoanApplication'. */
  @Prop({ required: true })
  targetEntity!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  targetId?: Types.ObjectId;

  @Prop({ type: AuditLogMetadataSchema, default: () => ({}) })
  metadata!: AuditLogMetadata;

  @Prop()
  ipAddress?: string;

  createdAt!: Date;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

// Critical index (master context 5.18).
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
