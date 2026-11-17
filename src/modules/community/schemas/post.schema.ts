import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type PostDocument = HydratedDocument<Post>;

/** What the author is sharing, so readers can filter the feed. */
export enum PostKind {
  Discussion = 'discussion',
  Question = 'question',
  Tip = 'tip',
  Market = 'market',
}

export enum PostStatus {
  Published = 'published',
  Removed = 'removed',
}

@Schema({
  collection: 'posts',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class Post {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true })
  content!: string;

  @Prop({ type: [String], default: [] })
  images!: string[];

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({
    required: true,
    type: String,
    enum: PostKind,
    default: PostKind.Discussion,
  })
  kind!: PostKind;

  /** Denormalised from post_likes, kept in step inside a transaction. */
  @Prop({ default: 0, min: 0 })
  likeCount!: number;

  /** Set when the author edits the post after publishing. */
  @Prop()
  editedAt?: Date;

  /** Denormalised counter - increment on new comment, decrement on delete. */
  @Prop({ default: 0, min: 0 })
  commentCount!: number;

  @Prop({
    required: true,
    type: String,
    enum: PostStatus,
    default: PostStatus.Published,
  })
  status!: PostStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PostSchema = SchemaFactory.createForClass(Post);

// Feed (newest first) and tag filtering.
PostSchema.index({ status: 1, createdAt: -1 });
PostSchema.index({ tags: 1, status: 1, createdAt: -1 });
PostSchema.index({ status: 1, kind: 1, createdAt: -1 });
PostSchema.index({ authorId: 1, status: 1, createdAt: -1 });
