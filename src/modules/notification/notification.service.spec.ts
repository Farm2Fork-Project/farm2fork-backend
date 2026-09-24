import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { FIREBASE_APP } from '../../infrastructure/firebase/firebase.constants';
import { User } from '../auth/schemas/user.schema';
import { NotificationService } from './notification.service';
import { Notification, NotificationType } from './schemas/notification.schema';

const sendEach = jest.fn();
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEach }),
}));

const chain = (value: unknown) => {
  const q: Record<string, unknown> = {
    exec: jest.fn().mockResolvedValue(value),
  };
  for (const m of ['select', 'lean', 'sort', 'skip', 'limit'])
    q[m] = jest.fn(() => q);
  return q;
};

describe('NotificationService', () => {
  const alice = new Types.ObjectId();
  const bob = new Types.ObjectId();
  let notificationModel: Record<string, jest.Mock>;
  let userModel: Record<string, jest.Mock>;

  async function build(firebaseApp: unknown) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getModelToken(Notification.name),
          useValue: notificationModel,
        },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: FIREBASE_APP, useValue: firebaseApp },
      ],
    }).compile();
    return moduleRef.get(NotificationService);
  }

  beforeEach(() => {
    sendEach.mockReset();
    notificationModel = {
      insertMany: jest.fn((docs: Array<Record<string, unknown>>) =>
        Promise.resolve(
          docs.map((doc) => ({ ...doc, _id: new Types.ObjectId() })),
        ),
      ),
      findOneAndUpdate: jest.fn(),
    };
    userModel = {
      find: jest.fn(() =>
        chain([
          { _id: alice, fcmToken: 'token-alice' },
          { _id: bob, fcmToken: 'token-bob' },
        ]),
      ),
      updateMany: jest.fn(() => chain({})),
      updateOne: jest.fn(() => chain({})),
    };
  });

  it('stores one notification per distinct user and pushes to their devices', async () => {
    sendEach.mockResolvedValue({
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    });
    const service = await build({});
    await service.notify({
      userIds: [alice, alice.toHexString(), bob],
      type: NotificationType.DeliveryOffer,
      title: 'New delivery',
      message: 'Multan → Lahore',
      relatedEntityId: new Types.ObjectId(),
      relatedEntityModel: 'Order',
    });

    expect(notificationModel.insertMany.mock.calls[0][0]).toHaveLength(2);
    const messages = sendEach.mock.calls[0][0];
    expect(messages.map((m: { token: string }) => m.token)).toEqual([
      'token-alice',
      'token-bob',
    ]);
    expect(messages[0].data).toEqual(
      expect.objectContaining({
        type: 'delivery_offer',
        relatedEntityModel: 'Order',
      }),
    );
    expect(messages[0].android.priority).toBe('high');
  });

  it('clears tokens FCM reports as no longer registered', async () => {
    sendEach.mockResolvedValue({
      failureCount: 1,
      responses: [
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        },
        { success: true },
      ],
    });
    const service = await build({});
    await service.notify({
      userIds: [alice, bob],
      type: NotificationType.PaymentConfirmed,
      title: 't',
      message: 'm',
    });
    expect(userModel.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [alice] } },
      { $unset: { fcmToken: 1 } },
    );
  });

  it('still stores in-app notifications when Firebase is not configured', async () => {
    const service = await build(null);
    await service.notify({
      userIds: [alice],
      type: NotificationType.OrderPlaced,
      title: 't',
      message: 'm',
    });
    expect(notificationModel.insertMany).toHaveBeenCalled();
    expect(sendEach).not.toHaveBeenCalled();
  });

  it('never throws from the background variant', async () => {
    notificationModel.insertMany.mockRejectedValue(new Error('db down'));
    const service = await build(null);
    expect(() =>
      service.notifyInBackground({
        userIds: [alice],
        type: NotificationType.OrderPlaced,
        title: 't',
        message: 'm',
      }),
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('only marks the caller’s own notification as read', async () => {
    notificationModel.findOneAndUpdate.mockReturnValue(chain(null));
    const service = await build(null);
    const id = new Types.ObjectId().toHexString();
    await expect(service.markRead(alice.toHexString(), id)).rejects.toThrow(
      'Notification not found',
    );
    expect(notificationModel.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: new Types.ObjectId(id),
      userId: alice,
    });
  });
});
