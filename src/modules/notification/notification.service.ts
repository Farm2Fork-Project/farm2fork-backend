import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { Model, Types } from 'mongoose';
import { FIREBASE_APP } from '../../infrastructure/firebase/firebase.constants';
import { User, UserDocument } from '../auth/schemas/user.schema';
import {
  NotificationPageDto,
  NotificationResponseDto,
  QueryNotificationsDto,
} from './dto/notification.dto';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';

export interface NotifyInput {
  userIds: Array<Types.ObjectId | string>;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityId?: Types.ObjectId | string;
  relatedEntityModel?: 'Order' | 'Shipment' | 'LoanApplication' | 'Post';
}

/** FCM errors that mean the stored token will never work again. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Creates in-app notifications and pushes them through FCM (master context
 * 6.5). Pushing is best-effort: the stored notification is the source of
 * truth, so a device without a token or an FCM outage loses nothing.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @Inject(FIREBASE_APP) private readonly firebaseApp: App | null,
  ) {}

  /**
   * Fire-and-forget variant for callers that must not fail or wait because a
   * notification could not be delivered (order, payment, shipment flows).
   */
  notifyInBackground(input: NotifyInput): void {
    this.notify(input).catch((error: unknown) =>
      this.logger.error(
        `Notification ${input.type} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      ),
    );
  }

  async notify(input: NotifyInput): Promise<void> {
    const userIds = [...new Set(input.userIds.map(String))].map(
      (id) => new Types.ObjectId(id),
    );
    if (userIds.length === 0) return;
    const relatedEntityId = input.relatedEntityId
      ? new Types.ObjectId(String(input.relatedEntityId))
      : undefined;

    const created = await this.notificationModel.insertMany(
      userIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        message: input.message,
        relatedEntityId,
        relatedEntityModel: input.relatedEntityModel,
      })),
    );
    await this.push(created);
  }

  async registerDeviceToken(userId: string, token: string): Promise<void> {
    // One device per account (users.fcmToken): a token moves to whoever
    // signed in on that device last.
    await this.userModel
      .updateMany(
        { fcmToken: { $eq: token }, _id: { $ne: new Types.ObjectId(userId) } },
        { $unset: { fcmToken: 1 } },
      )
      .exec();
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(userId) },
        { $set: { fcmToken: token } },
      )
      .exec();
  }

  async clearDeviceToken(userId: string): Promise<void> {
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(userId) },
        { $unset: { fcmToken: 1 } },
      )
      .exec();
  }

  async list(
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<NotificationPageDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const owner = { userId: new Types.ObjectId(userId) };
    const filter = query.unreadOnly ? { ...owner, isRead: false } : owner;
    const [items, total, unread] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
      this.notificationModel.countDocuments({ ...owner, isRead: false }).exec(),
    ]);
    return {
      data: items.map((n) => this.toResponse(n)),
      total,
      unread,
      page,
      limit,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.notificationModel
      .countDocuments({ userId: new Types.ObjectId(userId), isRead: false })
      .exec();
  }

  async markRead(userId: string, id: string): Promise<NotificationResponseDto> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Notification not found');
    const updated = await this.notificationModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
        { $set: { isRead: true } },
        { new: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('Notification not found');
    return this.toResponse(updated);
  }

  async markAllRead(userId: string): Promise<void> {
    await this.notificationModel
      .updateMany(
        { userId: new Types.ObjectId(userId), isRead: false },
        { $set: { isRead: true } },
      )
      .exec();
  }

  private async push(notifications: NotificationDocument[]): Promise<void> {
    if (!this.firebaseApp || notifications.length === 0) return;
    const users = await this.userModel
      .find({
        _id: { $in: notifications.map((n) => n.userId) },
        fcmToken: { $exists: true },
      })
      .select('+fcmToken')
      .lean()
      .exec();
    const tokens = new Map(
      users.map((u) => [u._id.toHexString(), u.fcmToken as string]),
    );
    const targets = notifications.filter((n) =>
      tokens.has(n.userId.toHexString()),
    );
    if (targets.length === 0) return;

    const response = await getMessaging(this.firebaseApp).sendEach(
      targets.map((n) => ({
        token: tokens.get(n.userId.toHexString())!,
        notification: { title: n.title, body: n.message },
        // Data values must be strings; the app routes on these.
        data: {
          notificationId: n._id.toHexString(),
          type: n.type,
          ...(n.relatedEntityId
            ? { relatedEntityId: n.relatedEntityId.toHexString() }
            : {}),
          ...(n.relatedEntityModel
            ? { relatedEntityModel: n.relatedEntityModel }
            : {}),
        },
        android: {
          priority:
            n.type === NotificationType.DeliveryOffer ? 'high' : 'normal',
          notification: { channelId: 'farm2fork_default' },
        },
      })),
    );

    const deadUserIds = response.responses.flatMap((result, index) =>
      !result.success && DEAD_TOKEN_CODES.has(result.error?.code ?? '')
        ? [targets[index].userId]
        : [],
    );
    if (deadUserIds.length > 0) {
      await this.userModel
        .updateMany({ _id: { $in: deadUserIds } }, { $unset: { fcmToken: 1 } })
        .exec();
    }
    if (response.failureCount > deadUserIds.length) {
      this.logger.warn(
        `FCM delivery failed for ${response.failureCount - deadUserIds.length} device(s)`,
      );
    }
  }

  private toResponse(n: NotificationDocument): NotificationResponseDto {
    return {
      id: n._id.toHexString(),
      type: n.type,
      title: n.title,
      message: n.message,
      relatedEntityId: n.relatedEntityId?.toHexString(),
      relatedEntityModel: n.relatedEntityModel,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    };
  }
}
