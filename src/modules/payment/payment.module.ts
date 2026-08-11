import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModule } from '../order/order.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';

/**
 * PaymentModule (EP-04). Registers the payments data layer and exposes the
 * payment API surface. Endpoints currently return DTO-shaped mock data; real
 * JazzCash/Stripe integration lands in Sprint 3.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
    OrderModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [MongooseModule, PaymentService],
})
export class PaymentModule {}
