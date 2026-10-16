import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import {
  DeliveryEarning,
  DeliveryEarningSchema,
  DeliveryPayout,
  DeliveryPayoutSchema,
  ManualRefund,
  ManualRefundSchema,
} from './schemas/delivery-finance.schema';
import { TransportModule } from '../transport/transport.module';
import { AdminModule } from '../admin/admin.module';
import { User, UserSchema } from '../auth/schemas/user.schema';
import {
  TransporterProfile,
  TransporterProfileSchema,
} from '../auth/schemas/transporter-profile.schema';
import { Order, OrderSchema } from '../order/schemas/order.schema';
import { Payment, PaymentSchema } from '../payment/schemas/payment.schema';
import { Shipment, ShipmentSchema } from '../transport/schemas/shipment.schema';
import { AuditLog, AuditLogSchema } from '../admin/schemas/audit-log.schema';
@Module({
  imports: [
    TransportModule,
    AdminModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: TransporterProfile.name, schema: TransporterProfileSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Shipment.name, schema: ShipmentSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: DeliveryEarning.name, schema: DeliveryEarningSchema },
      { name: DeliveryPayout.name, schema: DeliveryPayoutSchema },
      { name: ManualRefund.name, schema: ManualRefundSchema },
    ]),
  ],
  controllers: [DeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
