import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { OrderModule } from '../order/order.module';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { Comment, CommentSchema } from './schemas/comment.schema';
import {
  ContentReport,
  ContentReportSchema,
} from './schemas/content-report.schema';
import { PostLike, PostLikeSchema } from './schemas/post-like.schema';
import { Post, PostSchema } from './schemas/post.schema';
import { Review, ReviewSchema } from './schemas/review.schema';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

/** CommunityModule (EP-09): member posts, comments, likes, reports and buyer reviews. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: PostLike.name, schema: PostLikeSchema },
      { name: ContentReport.name, schema: ContentReportSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
    AuthModule,
    OrderModule,
  ],
  controllers: [CommunityController, ReviewController],
  providers: [CommunityService, ReviewService],
  exports: [MongooseModule],
})
export class CommunityModule {}
