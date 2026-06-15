import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

/**
 * NotificationModule (cross-cutting). Registers the notifications data layer.
 * FCM push delivery and notification triggers (master context 6.5) are wired in
 * as the modules that trigger them are built.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class NotificationModule {}
