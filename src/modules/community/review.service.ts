import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RequestUser } from '../../common/guards/roles.guard';
import {
  BuyerProfile,
  BuyerProfileDocument,
} from '../auth/schemas/buyer-profile.schema';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../order/schemas/order.schema';
import { CommunityService } from './community.service';
import { ReportContentDto } from './dto/community.dto';
import {
  CreateReviewDto,
  QueryReviewsDto,
  RatingSummaryDto,
  ReviewPageDto,
  ReviewReplyDto,
  ReviewResponseDto,
} from './dto/review.dto';
import { ReportTarget } from './schemas/content-report.schema';
import { Review, ReviewDocument, ReviewStatus } from './schemas/review.schema';

/**
 * ReviewService. A buyer rates the farmer once per delivered order, so every
 * rating is backed by a completed purchase. The farmer may answer once.
 */
@Injectable()
export class ReviewService {
  constructor(
    @InjectModel(Review.name)
    private readonly reviewModel: Model<ReviewDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(BuyerProfile.name)
    private readonly buyerProfileModel: Model<BuyerProfileDocument>,
    private readonly community: CommunityService,
    private readonly notifications: NotificationService,
  ) {}

  async create(
    user: RequestUser,
    dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    const order = await this.orderModel
      .findOne({
        _id: new Types.ObjectId(dto.orderId),
        buyerId: new Types.ObjectId(user.id),
      })
      .select('status farmerId items.productName')
      .lean()
      .exec();
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.Delivered) {
      throw new BadRequestException(
        'You can review an order once it has been delivered',
      );
    }
    try {
      const review = await this.reviewModel.create({
        orderId: order._id,
        buyerId: new Types.ObjectId(user.id),
        farmerId: order.farmerId,
        productNames: [...new Set(order.items.map((item) => item.productName))],
        rating: dto.rating,
        comment: dto.comment?.trim() || undefined,
        status: ReviewStatus.Published,
      });
      this.notifications.notifyInBackground({
        userIds: [order.farmerId],
        type: NotificationType.CommunityActivity,
        title: 'New buyer review',
        message: `A buyer rated your order ${dto.rating} out of 5.`,
        relatedEntityId: review._id,
        relatedEntityModel: 'Review',
      });
      return (await this.present([review]))[0];
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('You have already reviewed this order');
      }
      throw error;
    }
  }

  /** Reviews the signed-in buyer has written, so the app knows which orders are done. */
  async mine(user: RequestUser): Promise<ReviewResponseDto[]> {
    const reviews = await this.reviewModel
      .find({
        buyerId: new Types.ObjectId(user.id),
        status: ReviewStatus.Published,
      })
      .sort({ createdAt: -1 })
      .limit(200)
      .exec();
    return this.present(reviews);
  }

  async forFarmer(
    farmerId: string,
    query: QueryReviewsDto,
  ): Promise<ReviewPageDto> {
    if (!Types.ObjectId.isValid(farmerId)) {
      throw new NotFoundException('Farmer not found');
    }
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = {
      farmerId: new Types.ObjectId(farmerId),
      status: ReviewStatus.Published,
    };
    const [reviews, summary] = await Promise.all([
      this.reviewModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.summary(filter.farmerId),
    ]);
    return {
      summary,
      data: await this.present(reviews),
      total: summary.count,
      page,
      limit,
    };
  }

  async summary(farmerId: Types.ObjectId): Promise<RatingSummaryDto> {
    const rows = await this.reviewModel
      .aggregate<{
        _id: number;
        count: number;
      }>([
        { $match: { farmerId, status: ReviewStatus.Published } },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
      ])
      .exec();
    const distribution = [0, 0, 0, 0, 0];
    for (const row of rows) {
      if (row._id >= 1 && row._id <= 5) distribution[row._id - 1] = row.count;
    }
    const count = distribution.reduce((sum, n) => sum + n, 0);
    const total = distribution.reduce((sum, n, i) => sum + n * (i + 1), 0);
    return {
      average: count === 0 ? 0 : Math.round((total / count) * 10) / 10,
      count,
      distribution,
    };
  }

  async reply(
    id: string,
    user: RequestUser,
    dto: ReviewReplyDto,
  ): Promise<ReviewResponseDto> {
    const review = await this.requirePublished(id);
    if (review.farmerId.toHexString() !== user.id) {
      throw new ForbiddenException('Only the reviewed farmer can reply');
    }
    if (review.farmerReply) {
      throw new ConflictException('You have already replied to this review');
    }
    review.farmerReply = dto.reply.trim();
    review.farmerRepliedAt = new Date();
    await review.save();
    this.notifications.notifyInBackground({
      userIds: [review.buyerId],
      type: NotificationType.CommunityActivity,
      title: 'The farmer replied to your review',
      message: review.farmerReply,
      relatedEntityId: review._id,
      relatedEntityModel: 'Review',
    });
    return (await this.present([review]))[0];
  }

  async report(
    id: string,
    user: RequestUser,
    dto: ReportContentDto,
  ): Promise<void> {
    const review = await this.requirePublished(id);
    await this.community.fileReport(
      ReportTarget.Review,
      review._id,
      review.buyerId,
      user,
      dto,
    );
  }

  private async requirePublished(id: string): Promise<ReviewDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Review not found');
    }
    const review = await this.reviewModel
      .findOne({ _id: new Types.ObjectId(id), status: ReviewStatus.Published })
      .exec();
    if (!review) throw new NotFoundException('Review not found');
    return review;
  }

  private async present(
    reviews: ReviewDocument[],
  ): Promise<ReviewResponseDto[]> {
    if (reviews.length === 0) return [];
    const buyers = await this.buyerProfileModel
      .find({ userId: { $in: reviews.map((r) => r.buyerId) } })
      .select('userId businessName')
      .lean()
      .exec();
    const names = new Map(
      buyers.map((b) => [b.userId.toHexString(), b.businessName]),
    );
    return reviews.map((review) => ({
      id: review._id.toHexString(),
      orderId: review.orderId.toHexString(),
      farmerId: review.farmerId.toHexString(),
      buyerName: names.get(review.buyerId.toHexString()) ?? 'Farm2Fork buyer',
      productNames: review.productNames,
      rating: review.rating,
      comment: review.comment,
      farmerReply: review.farmerReply,
      farmerRepliedAt: review.farmerRepliedAt?.toISOString(),
      createdAt: review.createdAt.toISOString(),
    }));
  }
}
