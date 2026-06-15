import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type PostDocument = HydratedDocument<Post>;

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
