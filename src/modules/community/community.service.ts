import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { RequestUser } from '../../common/guards/roles.guard';
import { StorageService } from '../../infrastructure/storage/storage.service';
import {
  BuyerProfile,
  BuyerProfileDocument,
} from '../auth/schemas/buyer-profile.schema';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from '../auth/schemas/farmer-profile.schema';
import { User, UserDocument } from '../auth/schemas/user.schema';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import {
  CommentResponseDto,
  CommunityAuthorDto,
  CreateCommentDto,
  CreatePostDto,
  LikeStateDto,
  MAX_POST_IMAGES,
  MemberProfileDto,
  PostPageDto,
  PostResponseDto,
  QueryPostsDto,
  ReportContentDto,
  TagCountDto,
  UpdatePostDto,
} from './dto/community.dto';
import {
  ContentReport,
  ContentReportDocument,
  ReportStatus,
  ReportTarget,
} from './schemas/content-report.schema';
import { PostLike, PostLikeDocument } from './schemas/post-like.schema';
import { Review, ReviewDocument, ReviewStatus } from './schemas/review.schema';
import {
  Comment,
  CommentDocument,
  CommentStatus,
} from './schemas/comment.schema';
import {
  Post,
  PostDocument,
  PostKind,
  PostStatus,
} from './schemas/post.schema';

export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

const COMMENTS_PAGE_LIMIT = 100;
const TRENDING_TAG_DAYS = 30;
const TRENDING_TAG_LIMIT = 12;

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

/**
 * CommunityService (EP-09, US-13/14). Farmers and buyers share posts and
 * comment on them; authors and admins can remove their own content (soft
 * delete: status "removed"). commentCount is kept in step with comments
 * inside a transaction (master context 5.13).
 */
@Injectable()
export class CommunityService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
    @InjectModel(BuyerProfile.name)
    private readonly buyerProfileModel: Model<BuyerProfileDocument>,
    @InjectModel(PostLike.name)
    private readonly likeModel: Model<PostLikeDocument>,
    @InjectModel(ContentReport.name)
    private readonly reportModel: Model<ContentReportDocument>,
    @InjectModel(Review.name)
    private readonly reviewModel: Model<ReviewDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
  ) {}

  async list(query: QueryPostsDto, user: RequestUser): Promise<PostPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: FilterQuery<PostDocument> = { status: PostStatus.Published };
    if (query.tag) filter.tags = { $eq: query.tag };
    if (query.kind) filter.kind = { $eq: query.kind };
    const words = query.q?.trim();
    if (words) {
      const pattern = new RegExp(escapeRegex(words), 'i');
      filter.$or = [{ title: pattern }, { content: pattern }];
    }
    if (query.authorId) {
      if (!Types.ObjectId.isValid(query.authorId)) {
        throw new BadRequestException('Invalid authorId');
      }
      filter.authorId = { $eq: new Types.ObjectId(query.authorId) };
    }

    const [posts, total] = await Promise.all([
      this.postModel
        .find(filter)
        .sort(
          query.sort === 'top'
            ? { likeCount: -1, commentCount: -1, createdAt: -1 }
            : { createdAt: -1 },
        )
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.postModel.countDocuments(filter).exec(),
    ]);
    const [authors, liked] = await Promise.all([
      this.authors(posts.map((p) => p.authorId)),
      this.likedBy(
        user,
        posts.map((p) => p._id),
      ),
    ]);
    return {
      data: posts.map((post) => this.toPost(post, authors, liked)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, user: RequestUser): Promise<PostResponseDto> {
    const post = await this.requirePublishedPost(id);
    return this.present(post, user);
  }

  /** Tags used most in recent posts, for the feed's topic chips. */
  async trendingTags(): Promise<TagCountDto[]> {
    const since = new Date(Date.now() - TRENDING_TAG_DAYS * 86_400_000);
    const rows = await this.postModel
      .aggregate<{
        _id: string;
        count: number;
      }>([
        {
          $match: { status: PostStatus.Published, createdAt: { $gte: since } },
        },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: TRENDING_TAG_LIMIT },
      ])
      .exec();
    return rows.map((row) => ({ tag: row._id, count: row.count }));
  }

  /** Public face of a member: display name, role, activity and, for farmers, rating. */
  async member(id: string): Promise<MemberProfileDto> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Member not found');
    const memberId = new Types.ObjectId(id);
    const user = await this.userModel
      .findOne({ _id: memberId, isActive: true })
      .select('role createdAt')
      .lean()
      .exec();
    if (!user) throw new NotFoundException('Member not found');
    const [authors, postCount, rating] = await Promise.all([
      this.authors([memberId]),
      this.postModel
        .countDocuments({ authorId: memberId, status: PostStatus.Published })
        .exec(),
      user.role === UserRole.Farmer
        ? this.reviewModel
            .aggregate<{ average: number; count: number }>([
              {
                $match: { farmerId: memberId, status: ReviewStatus.Published },
              },
              {
                $group: {
                  _id: null,
                  average: { $avg: '$rating' },
                  count: { $sum: 1 },
                },
              },
            ])
            .exec()
        : Promise.resolve([]),
    ]);
    const author = this.author(memberId, authors);
    return {
      ...author,
      joinedAt: (
        user as unknown as { createdAt: Date }
      ).createdAt.toISOString(),
      postCount,
      ...(user.role === UserRole.Farmer
        ? {
            averageRating: rating[0]
              ? Math.round(rating[0].average * 10) / 10
              : undefined,
            reviewCount: rating[0]?.count ?? 0,
          }
        : {}),
    };
  }

  async create(
    user: RequestUser,
    dto: CreatePostDto,
    images: UploadedImage[] = [],
  ): Promise<PostResponseDto> {
    if (!Array.isArray(images)) {
      throw new BadRequestException('Invalid images payload');
    }
    if (images.length > MAX_POST_IMAGES) {
      throw new BadRequestException(`Attach at most ${MAX_POST_IMAGES} photos`);
    }
    images.forEach((image) => {
      if (
        !image ||
        typeof image !== 'object' ||
        !(image.buffer instanceof Buffer)
      ) {
        throw new BadRequestException('Invalid image file');
      }
      this.storage.validate(image.buffer, 'image');
    });
    const urls: string[] = [];
    for (const image of images) {
      urls.push(
        await this.storage.uploadPublicImage(image.buffer, 'community'),
      );
    }
    const post = await this.postModel.create({
      authorId: new Types.ObjectId(user.id),
      title: dto.title,
      content: dto.content.trim(),
      tags: dto.tags ?? [],
      kind: dto.kind,
      images: urls,
      status: PostStatus.Published,
    });
    return this.present(post, user);
  }

  /** Only the author can edit; an admin hides instead of rewriting. */
  async update(
    id: string,
    user: RequestUser,
    dto: UpdatePostDto,
  ): Promise<PostResponseDto> {
    const post = await this.requirePublishedPost(id);
    if (post.authorId.toHexString() !== user.id) {
      throw new ForbiddenException('You can only edit your own post');
    }
    if (dto.title !== undefined) post.title = dto.title;
    if (dto.content !== undefined) post.content = dto.content.trim();
    if (dto.tags !== undefined) post.tags = dto.tags;
    if (dto.kind !== undefined) post.kind = dto.kind;
    post.editedAt = new Date();
    await post.save();
    return this.present(post, user);
  }

  async like(id: string, user: RequestUser): Promise<LikeStateDto> {
    const post = await this.requirePublishedPost(id);
    const userId = new Types.ObjectId(user.id);
    const session = await this.connection.startSession();
    let added = false;
    try {
      await session.withTransaction(async () => {
        added = false;
        const existing = await this.likeModel
          .exists({ postId: post._id, userId })
          .session(session)
          .exec();
        if (existing) return;
        await this.likeModel.create([{ postId: post._id, userId }], {
          session,
        });
        await this.postModel
          .updateOne({ _id: post._id }, { $inc: { likeCount: 1 } }, { session })
          .exec();
        added = true;
      });
    } catch (error) {
      // Two taps raced: the unique index kept a single like.
      if (!isDuplicateKey(error)) throw error;
    } finally {
      await session.endSession();
    }
    if (added && post.authorId.toHexString() !== user.id) {
      this.notifications.notifyInBackground({
        userIds: [post.authorId],
        type: NotificationType.CommunityActivity,
        title: 'Someone liked your post',
        message: post.title,
        relatedEntityId: post._id,
        relatedEntityModel: 'Post',
      });
    }
    return this.likeState(post._id, true);
  }

  async unlike(id: string, user: RequestUser): Promise<LikeStateDto> {
    const post = await this.requirePublishedPost(id);
    const userId = new Types.ObjectId(user.id);
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const removed = await this.likeModel
          .deleteOne({ postId: post._id, userId }, { session })
          .exec();
        if (removed.deletedCount === 0) return;
        await this.postModel
          .updateOne(
            { _id: post._id, likeCount: { $gt: 0 } },
            { $inc: { likeCount: -1 } },
            { session },
          )
          .exec();
      });
    } finally {
      await session.endSession();
    }
    return this.likeState(post._id, false);
  }

  async reportPost(
    id: string,
    user: RequestUser,
    dto: ReportContentDto,
  ): Promise<void> {
    const post = await this.requirePublishedPost(id);
    await this.fileReport(
      ReportTarget.Post,
      post._id,
      post.authorId,
      user,
      dto,
    );
  }

  async reportComment(
    postId: string,
    commentId: string,
    user: RequestUser,
    dto: ReportContentDto,
  ): Promise<void> {
    const comment = await this.requireActiveComment(postId, commentId);
    await this.fileReport(
      ReportTarget.Comment,
      comment._id,
      comment.authorId,
      user,
      dto,
    );
  }

  /** Shared by posts, comments and reviews: one open report per member per item. */
  async fileReport(
    targetType: ReportTarget,
    targetId: Types.ObjectId,
    authorId: Types.ObjectId,
    user: RequestUser,
    dto: ReportContentDto,
  ): Promise<void> {
    if (authorId.toHexString() === user.id) {
      throw new BadRequestException('You cannot report your own content');
    }
    try {
      await this.reportModel.create({
        targetType,
        targetId,
        reporterId: new Types.ObjectId(user.id),
        reason: dto.reason,
        note: dto.note?.trim() || undefined,
        status: ReportStatus.Open,
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('You have already reported this');
      }
      throw error;
    }
  }

  async remove(id: string, user: RequestUser): Promise<void> {
    const post = await this.requirePublishedPost(id);
    this.assertCanModerate(post.authorId, user);
    post.status = PostStatus.Removed;
    await post.save();
  }

  async listComments(postId: string): Promise<CommentResponseDto[]> {
    const post = await this.requirePublishedPost(postId);
    const comments = await this.commentModel
      .find({ postId: post._id, status: CommentStatus.Active })
      .sort({ createdAt: 1 })
      .limit(COMMENTS_PAGE_LIMIT)
      .exec();
    const authors = await this.authors(comments.map((c) => c.authorId));
    return comments.map((comment) => this.toComment(comment, authors));
  }

  async addComment(
    postId: string,
    user: RequestUser,
    dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const post = await this.requirePublishedPost(postId);
    // Replies are one level deep: a reply to a reply attaches to the same parent.
    let parent: CommentDocument | null = null;
    if (dto.parentCommentId) {
      parent = await this.requireActiveComment(postId, dto.parentCommentId);
    }
    const parentCommentId = parent
      ? (parent.parentCommentId ?? parent._id)
      : null;
    const session = await this.connection.startSession();
    try {
      const comment = await session.withTransaction(async () => {
        const [created] = await this.commentModel.create(
          [
            {
              postId: post._id,
              authorId: new Types.ObjectId(user.id),
              content: dto.content.trim(),
              parentCommentId,
              status: CommentStatus.Active,
            },
          ],
          { session },
        );
        await this.postModel
          .updateOne(
            { _id: post._id },
            { $inc: { commentCount: 1 } },
            { session },
          )
          .exec();
        return created;
      });
      const recipients = [post.authorId, parent?.authorId]
        .filter((id): id is Types.ObjectId => !!id)
        .filter((id) => id.toHexString() !== user.id);
      if (recipients.length > 0) {
        this.notifications.notifyInBackground({
          userIds: recipients,
          type: NotificationType.CommunityActivity,
          title: 'New reply in the community',
          message: post.title,
          relatedEntityId: post._id,
          relatedEntityModel: 'Post',
        });
      }
      return this.toComment(comment, await this.authors([comment.authorId]));
    } finally {
      await session.endSession();
    }
  }

  async removeComment(
    postId: string,
    commentId: string,
    user: RequestUser,
  ): Promise<void> {
    const comment = await this.requireActiveComment(postId, commentId);
    this.assertCanModerate(comment.authorId, user);

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const removed = await this.commentModel
          .updateOne(
            { _id: comment._id, status: CommentStatus.Active },
            { $set: { status: CommentStatus.Removed } },
            { session },
          )
          .exec();
        // A concurrent delete already decremented the counter.
        if (removed.modifiedCount === 0) return;
        await this.postModel
          .updateOne(
            { _id: comment.postId, commentCount: { $gt: 0 } },
            { $inc: { commentCount: -1 } },
            { session },
          )
          .exec();
      });
    } finally {
      await session.endSession();
    }
  }

  // --- internals ------------------------------------------------------------

  private assertCanModerate(authorId: Types.ObjectId, user: RequestUser) {
    if (user.role !== UserRole.Admin && authorId.toHexString() !== user.id) {
      throw new ForbiddenException('You can only remove your own content');
    }
  }

  private async requireActiveComment(
    postId: string,
    commentId: string,
  ): Promise<CommentDocument> {
    if (!Types.ObjectId.isValid(postId) || !Types.ObjectId.isValid(commentId)) {
      throw new NotFoundException('Comment not found');
    }
    const comment = await this.commentModel
      .findOne({
        _id: new Types.ObjectId(commentId),
        postId: new Types.ObjectId(postId),
        status: CommentStatus.Active,
      })
      .exec();
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  private async present(
    post: PostDocument,
    user: RequestUser,
  ): Promise<PostResponseDto> {
    const [authors, liked] = await Promise.all([
      this.authors([post.authorId]),
      this.likedBy(user, [post._id]),
    ]);
    return this.toPost(post, authors, liked);
  }

  private async likedBy(
    user: RequestUser,
    postIds: Types.ObjectId[],
  ): Promise<Set<string>> {
    if (postIds.length === 0) return new Set();
    const likes = await this.likeModel
      .find({ userId: new Types.ObjectId(user.id), postId: { $in: postIds } })
      .select('postId')
      .lean()
      .exec();
    return new Set(likes.map((like) => like.postId.toHexString()));
  }

  private async likeState(
    postId: Types.ObjectId,
    likedByMe: boolean,
  ): Promise<LikeStateDto> {
    const fresh = await this.postModel
      .findById(postId)
      .select('likeCount')
      .lean()
      .exec();
    return { likeCount: fresh?.likeCount ?? 0, likedByMe };
  }

  private async requirePublishedPost(id: string): Promise<PostDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Post not found');
    const post = await this.postModel
      .findOne({ _id: new Types.ObjectId(id), status: PostStatus.Published })
      .exec();
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  /** Public display names: farm or business name, never email or CNIC. */
  private async authors(
    ids: Types.ObjectId[],
  ): Promise<Map<string, CommunityAuthorDto>> {
    const unique = [
      ...new Map(ids.map((id) => [id.toHexString(), id])).values(),
    ];
    if (unique.length === 0) return new Map();
    const [users, farms, buyers] = await Promise.all([
      this.userModel
        .find({ _id: { $in: unique } })
        .select('role fullName')
        .lean()
        .exec(),
      this.farmerProfileModel
        .find({ userId: { $in: unique } })
        .select('userId farmName farmLocation.city')
        .lean()
        .exec(),
      this.buyerProfileModel
        .find({ userId: { $in: unique } })
        .select('userId businessName')
        .lean()
        .exec(),
    ]);
    const farmById = new Map(farms.map((f) => [f.userId.toHexString(), f]));
    const buyerById = new Map(buyers.map((b) => [b.userId.toHexString(), b]));
    return new Map(
      users.map((u) => {
        const id = u._id.toHexString();
        const farm = farmById.get(id);
        const buyer = buyerById.get(id);
        const name =
          u.role === UserRole.Admin
            ? 'Farm2Fork team'
            : (farm?.farmName ??
              buyer?.businessName ??
              u.fullName?.trim() ??
              'Farm2Fork member');
        return [id, { id, name, role: u.role, city: farm?.farmLocation?.city }];
      }),
    );
  }

  private author(
    id: Types.ObjectId,
    authors: Map<string, CommunityAuthorDto>,
  ): CommunityAuthorDto {
    const key = id.toHexString();
    return (
      authors.get(key) ?? { id: key, name: 'Farm2Fork member', role: 'buyer' }
    );
  }

  private toPost(
    post: PostDocument,
    authors: Map<string, CommunityAuthorDto>,
    liked: Set<string> = new Set(),
  ): PostResponseDto {
    return {
      id: post._id.toHexString(),
      author: this.author(post.authorId, authors),
      title: post.title,
      content: post.content,
      images: post.images,
      tags: post.tags,
      kind: post.kind ?? PostKind.Discussion,
      commentCount: post.commentCount,
      likeCount: post.likeCount ?? 0,
      likedByMe: liked.has(post._id.toHexString()),
      editedAt: post.editedAt?.toISOString(),
      createdAt: post.createdAt.toISOString(),
    };
  }

  private toComment(
    comment: CommentDocument,
    authors: Map<string, CommunityAuthorDto>,
  ): CommentResponseDto {
    return {
      id: comment._id.toHexString(),
      postId: comment.postId.toHexString(),
      author: this.author(comment.authorId, authors),
      content: comment.content,
      parentCommentId: comment.parentCommentId?.toHexString(),
      createdAt: comment.createdAt.toISOString(),
    };
  }
}
