import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { OrderModule } from '../order/order.module';
import { TransportController } from './transport.controller';
import { Shipment, ShipmentSchema } from './schemas/shipment.schema';
import { TransportService } from './transport.service';

/**
 * TransportModule (EP-07): proximity dispatch of paid orders to nearby
 * transporters, delivery acceptance and status tracking.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shipment.name, schema: ShipmentSchema },
    ]),
    AuthModule,
    AdminModule,
    OrderModule,
    BlockchainModule,
  ],
  controllers: [TransportController],
  providers: [TransportService],
  exports: [MongooseModule, TransportService],
})
export class TransportModule {}
