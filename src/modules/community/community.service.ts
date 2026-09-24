import {
  BadRequestException,
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
import {
  CommentResponseDto,
  CommunityAuthorDto,
  CreateCommentDto,
  CreatePostDto,
  MAX_POST_IMAGES,
  PostPageDto,
  PostResponseDto,
  QueryPostsDto,
} from './dto/community.dto';
import {
  Comment,
  CommentDocument,
  CommentStatus,
} from './schemas/comment.schema';
import { Post, PostDocument, PostStatus } from './schemas/post.schema';

export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

const COMMENTS_PAGE_LIMIT = 100;

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
    @InjectConnection() private readonly connection: Connection,
    private readonly storage: StorageService,
  ) {}

  async list(query: QueryPostsDto): Promise<PostPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: FilterQuery<PostDocument> = { status: PostStatus.Published };
    if (query.tag) filter.tags = query.tag;
    if (query.authorId) filter.authorId = new Types.ObjectId(query.authorId);

    const [posts, total] = await Promise.all([
      this.postModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.postModel.countDocuments(filter).exec(),
    ]);
    const authors = await this.authors(posts.map((p) => p.authorId));
    return {
      data: posts.map((post) => this.toPost(post, authors)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string): Promise<PostResponseDto> {
    const post = await this.requirePublishedPost(id);
    return this.toPost(post, await this.authors([post.authorId]));
  }

  async create(
    user: RequestUser,
    dto: CreatePostDto,
    images: UploadedImage[] = [],
  ): Promise<PostResponseDto> {
    if (images.length > MAX_POST_IMAGES) {
      throw new BadRequestException(`Attach at most ${MAX_POST_IMAGES} photos`);
    }
    images.forEach((image) => this.storage.validate(image.buffer, 'image'));
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
      images: urls,
      status: PostStatus.Published,
    });
    return this.toPost(post, await this.authors([post.authorId]));
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
    const session = await this.connection.startSession();
    try {
      const comment = await session.withTransaction(async () => {
        const [created] = await this.commentModel.create(
          [
            {
              postId: post._id,
              authorId: new Types.ObjectId(user.id),
              content: dto.content.trim(),
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
        .select('role')
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
            : (farm?.farmName ?? buyer?.businessName ?? 'Farm2Fork member');
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
  ): PostResponseDto {
    return {
      id: post._id.toHexString(),
      author: this.author(post.authorId, authors),
      title: post.title,
      content: post.content,
      images: post.images,
      tags: post.tags,
      commentCount: post.commentCount,
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
      createdAt: comment.createdAt.toISOString(),
    };
  }
}
