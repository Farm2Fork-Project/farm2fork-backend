import {
  Shipment,
  ShipmentDocument,
  ShipmentStatus,
} from '../transport/schemas/shipment.schema';
import { activeDeliveryFilter } from '../transport/active-delivery';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import {
  Product,
  ProductDocument,
  ProductStatus,
} from '../marketplace/schemas/product.schema';
import {
  Order,
  OrderDocument,
  OrderStatus,
} from '../order/schemas/order.schema';
import {
  Post,
  PostDocument,
  PostStatus,
} from '../community/schemas/post.schema';
import {
  Comment,
  CommentDocument,
  CommentStatus,
} from '../community/schemas/comment.schema';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import type { RequestUser } from '../../common/guards/roles.guard';
import type {
  ContentQueryDto,
  ContentVisibilityDto,
} from './admin-content.controller';

export interface AdminPostDetail {
  id: string;
  authorId: unknown;
  title: string;
  content: string;
  images: string[];
  tags: string[];
  commentCount: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  comments: {
    id: string;
    authorId: unknown;
    content: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }[];
  commentsLimit: number;
}
const USER_FIELDS = 'fullName email role';
const PRODUCT_FIELDS =
  'name category description farmerId price quantity unit images qualityGrade status adminHidden createdAt updatedAt';
const ORDER_FIELDS =
  'buyerId farmerId items totalAmount platformFeePercent platformFeeAmount deliveryFee deliveryDistanceKm grandTotal status paymentId shipmentId shippingAddress createdAt updatedAt';
const POST_FIELDS =
  'authorId title content images tags commentCount status createdAt updatedAt';
function objectId(id: string) {
  if (!Types.ObjectId.isValid(id))
    throw new BadRequestException('Invalid identifier');
  return new Types.ObjectId(id);
}
function literal(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function pageValues(query: Partial<ContentQueryDto>) {
  return { page: query.page ?? 1, limit: query.limit ?? 20 };
}
export function contentStatus(value: string | undefined, allowed: string[]) {
  if (value && !allowed.includes(value))
    throw new BadRequestException('Unsupported status filter');
  return value;
}
function record<T extends { _id: unknown }>(value: T) {
  const { _id, ...rest } = value;
  return { ...rest, id: String(_id) };
}
@Injectable()
export class AdminContentService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<CommentDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditModel: Model<AuditLogDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}
  async products(query: Partial<ContentQueryDto>) {
    const { page, limit } = pageValues(query);
    const status = contentStatus(query.status, Object.values(ProductStatus));
    const filter = {
      ...(status ? { status } : {}),
      ...(query.visibility
        ? { adminHidden: query.visibility === 'hidden' ? true : { $ne: true } }
        : {}),
      ...(query.search?.trim()
        ? {
            $or: [
              { name: new RegExp(literal(query.search.trim()), 'i') },
              { category: new RegExp(literal(query.search.trim()), 'i') },
              ...(Types.ObjectId.isValid(query.search.trim())
                ? [{ _id: new Types.ObjectId(query.search.trim()) }]
                : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.productModel
        .find(filter)
        .select(PRODUCT_FIELDS)
        .populate('farmerId', USER_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.productModel.countDocuments(filter),
    ]);
    return { items: items.map(record), total, page, limit };
  }
  async product(id: string) {
    const value = await this.productModel
      .findById(objectId(id))
      .select(PRODUCT_FIELDS)
      .populate('farmerId', USER_FIELDS)
      .lean()
      .exec();
    if (!value) throw new NotFoundException('Product not found');
    return record(value);
  }
  async orders(query: Partial<ContentQueryDto>) {
    const { page, limit } = pageValues(query);
    const status = contentStatus(query.status, Object.values(OrderStatus));
    const search = query.search?.trim();
    const issueShipments = query.deliveryIssue
      ? await this.connection
          .model<ShipmentDocument>(Shipment.name)
          .find(
            query.deliveryIssue === 'active'
              ? activeDeliveryFilter()
              : query.deliveryIssue === 'unresolved'
                ? {
                    status: ShipmentStatus.Failed,
                    'issue.resolvedAt': { $exists: false },
                  }
                : { 'issue.resolvedAt': { $exists: true } },
          )
          .select('_id')
          .lean()
          .exec()
      : undefined;
    const filter = {
      ...(issueShipments
        ? {
            $and: [
              { shipmentId: { $in: issueShipments.map((ship) => ship._id) } },
            ],
          }
        : {}),
      ...(query.assignment
        ? { shipmentId: query.assignment === 'assigned' ? { $ne: null } : null }
        : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            $or: [
              { 'items.productName': new RegExp(literal(search), 'i') },
              ...(Types.ObjectId.isValid(search)
                ? [
                    { _id: new Types.ObjectId(search) },
                    { buyerId: new Types.ObjectId(search) },
                    { farmerId: new Types.ObjectId(search) },
                    { shipmentId: new Types.ObjectId(search) },
                  ]
                : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .select(ORDER_FIELDS)
        .populate('buyerId farmerId', USER_FIELDS)
        .populate('shipmentId', 'status issue actualDelivery')
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.orderModel.countDocuments(filter),
    ]);
    return { items: items.map(record), total, page, limit };
  }
  async order(id: string) {
    const value = await this.orderModel
      .findById(objectId(id))
      .select(ORDER_FIELDS)
      .populate('buyerId farmerId', USER_FIELDS)
      .populate(
        'paymentId',
        'amount currency gateway status paidAt failedAt refundedAt',
      )
      .populate({
        path: 'shipmentId',
        select:
          'status transporterId statusHistory assignmentHistory issue deliveryFee actualDelivery createdAt updatedAt',
        populate: { path: 'transporterId', select: USER_FIELDS },
      })
      .lean()
      .exec();
    if (!value) throw new NotFoundException('Order not found');
    return record(value);
  }
  async posts(query: Partial<ContentQueryDto>) {
    const { page, limit } = pageValues(query);
    const status = contentStatus(query.status, Object.values(PostStatus));
    const filter = {
      ...(status ? { status } : {}),
      ...(query.search?.trim()
        ? {
            $or: [
              { title: new RegExp(literal(query.search.trim()), 'i') },
              { content: new RegExp(literal(query.search.trim()), 'i') },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.postModel
        .find(filter)
        .select(POST_FIELDS)
        .populate('authorId', USER_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.postModel.countDocuments(filter),
    ]);
    return { items: items.map(record), total, page, limit };
  }
  async post(id: string): Promise<AdminPostDetail> {
    const target = objectId(id);
    const [post, comments] = await Promise.all([
      this.postModel
        .findById(target)
        .select(POST_FIELDS)
        .populate('authorId', USER_FIELDS)
        .lean()
        .exec(),
      this.commentModel
        .find({ postId: target })
        .select('authorId content status createdAt updatedAt')
        .populate('authorId', USER_FIELDS)
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
        .exec(),
    ]);
    if (!post) throw new NotFoundException('Post not found');
    return {
      ...record(post),
      comments: comments.map(record),
      commentsLimit: 100,
    };
  }
  async visibility(
    kind: 'product' | 'post' | 'comment',
    id: string,
    dto: ContentVisibilityDto,
    actor: RequestUser,
  ) {
    const target = objectId(id);
    if (
      typeof dto.hidden !== 'boolean' ||
      typeof dto.reason !== 'string' ||
      dto.reason.trim().length < 5 ||
      dto.reason.trim().length > 500
    )
      throw new BadRequestException(
        'Enter a reason between 5 and 500 characters',
      );
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const field = kind === 'product' ? 'adminHidden' : 'status';
        const before =
          kind === 'product'
            ? dto.hidden
              ? { $ne: true }
              : true
            : kind === 'post'
              ? dto.hidden
                ? PostStatus.Published
                : PostStatus.Removed
              : dto.hidden
                ? CommentStatus.Active
                : CommentStatus.Removed;
        const after =
          kind === 'product'
            ? dto.hidden
            : kind === 'post'
              ? dto.hidden
                ? PostStatus.Removed
                : PostStatus.Published
              : dto.hidden
                ? CommentStatus.Removed
                : CommentStatus.Active;
        const model = (kind === 'product'
          ? this.productModel
          : kind === 'post'
            ? this.postModel
            : this.commentModel) as unknown as Model<{
          adminHidden?: boolean;
          status?: string;
          postId?: Types.ObjectId;
        }>;
        const result = await model
          .findOneAndUpdate(
            { _id: target, [field]: before },
            { $set: { [field]: after } },
            { new: true, session },
          )
          .lean()
          .exec();
        if (!result)
          throw new ConflictException(
            'Content changed or no longer exists. Refresh before trying again.',
          );
        if (kind === 'comment')
          await this.postModel.updateOne(
            { _id: (result as unknown as { postId: Types.ObjectId }).postId },
            { $inc: { commentCount: dto.hidden ? -1 : 1 } },
            { session },
          );
        await this.auditModel.create(
          [
            {
              actorId: objectId(actor.id),
              actorRole: actor.role,
              action: `${kind}.${dto.hidden ? 'hidden' : 'restored'}`,
              targetEntity:
                kind === 'product'
                  ? 'Product'
                  : kind === 'post'
                    ? 'Post'
                    : 'Comment',
              targetId: target,
              metadata: {
                before: { hidden: !dto.hidden },
                after: { hidden: dto.hidden, reason: dto.reason.trim() },
              },
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    return { id, hidden: dto.hidden };
  }
}
