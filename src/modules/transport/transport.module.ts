import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { OrderModule } from '../order/order.module';
import { Shipment, ShipmentSchema } from './schemas/shipment.schema';
import { TransportService } from './transport.service';

/**
 * TransportModule (EP-07). Registers the shipments data layer. Shipment
 * assignment and delivery tracking arrive in Sprint 6.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shipment.name, schema: ShipmentSchema },
    ]),
    AuthModule,
    OrderModule,
    BlockchainModule,
  ],
  providers: [TransportService],
  exports: [MongooseModule, TransportService],
})
export class TransportModule {}
