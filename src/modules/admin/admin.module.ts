import { Payment, PaymentSchema } from '../payment/schemas/payment.schema';
import { AdminContentService } from './admin-content.service';
import { AdminContentController } from './admin-content.controller';
import { Post, PostSchema } from '../community/schemas/post.schema';
import { Comment, CommentSchema } from '../community/schemas/comment.schema';
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User, UserSchema } from '../auth/schemas/user.schema';
import {
  TransporterProfile,
  TransporterProfileSchema,
} from '../auth/schemas/transporter-profile.schema';
import { Order, OrderSchema } from '../order/schemas/order.schema';
import { Product, ProductSchema } from '../marketplace/schemas/product.schema';
import { Shipment, ShipmentSchema } from '../transport/schemas/shipment.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import {
  SystemConfig,
  SystemConfigSchema,
} from './schemas/system-config.schema';
import { SystemConfigService } from './services/system-config.service';

/**
 * AdminModule (EP-08). Registers the audit_logs and system_config data layers
 * and exposes the typed SystemConfigService (the only sanctioned way to read
 * system_config). User management and audit-log viewing arrive in Sprint 7.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: User.name, schema: UserSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: TransporterProfile.name, schema: TransporterProfileSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Shipment.name, schema: ShipmentSchema },
      { name: SystemConfig.name, schema: SystemConfigSchema },
    ]),
  ],
  controllers: [AdminController, AdminContentController],
  providers: [SystemConfigService, AdminService, AdminContentService],
  exports: [MongooseModule, SystemConfigService],
})
export class AdminModule {}
