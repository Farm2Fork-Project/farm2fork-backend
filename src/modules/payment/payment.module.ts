import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { OrderModule } from '../order/order.module';
import { TransportModule } from '../transport/transport.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { SafepayClient } from './safepay/safepay.client';
import { Payment, PaymentSchema } from './schemas/payment.schema';

/**
 * PaymentModule (EP-04). Registers the payments data layer and exposes the
 * payment API surface. Safepay is integrated for real (hosted checkout +
 * webhook settlement); JazzCash/Stripe remain DTO-shaped mock placeholders.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
    OrderModule,
    MarketplaceModule,
    BlockchainModule,
    TransportModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService, SafepayClient],
  exports: [MongooseModule, PaymentService],
})
export class PaymentModule {}
