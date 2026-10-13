import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type CommentDocument = HydratedDocument<Comment>;

export enum CommentStatus {
  Active = 'active',
  Removed = 'removed',
}

@Schema({
  collection: 'comments',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class Comment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Post',
    required: true,
    index: true,
  })
  postId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  @Prop({ required: true })
  content!: string;

  /**
   * Null for MVP. Field exists to support nested replies in the future
   * without a schema migration (master context 5.14).
   */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Comment', default: null })
  parentCommentId!: Types.ObjectId | null;

  @Prop({
    required: true,
    type: String,
    enum: CommentStatus,
    default: CommentStatus.Active,
  })
  status!: CommentStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
