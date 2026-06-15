import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Post, PostSchema } from './schemas/post.schema';

/**
 * CommunityModule (EP-09). Registers the posts and comments data layers.
 * Community feed, posts and comments arrive in Sprint 8.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class CommunityModule {}
