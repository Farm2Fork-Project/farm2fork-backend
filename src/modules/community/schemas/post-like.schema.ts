import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type PostLikeDocument = HydratedDocument<PostLike>;

/** One row per (post, user); the unique index makes a like idempotent. */
@Schema({
  collection: 'post_likes',
  timestamps: { createdAt: true, updatedAt: false },
})
export class PostLike {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Post', required: true })
  postId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  createdAt!: Date;
}

export const PostLikeSchema = SchemaFactory.createForClass(PostLike);
PostLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
PostLikeSchema.index({ userId: 1, postId: 1 });
