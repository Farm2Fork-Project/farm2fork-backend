import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Payment, PaymentSchema } from './schemas/payment.schema';

/**
 * PaymentModule (EP-04). Registers the payments data layer. JazzCash/Stripe
 * integration and platform-fee handling arrive in Sprint 3.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
  ],
  exports: [MongooseModule],
})
export class PaymentModule {}
