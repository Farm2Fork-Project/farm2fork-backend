import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Shipment, ShipmentSchema } from './schemas/shipment.schema';

/**
 * TransportModule (EP-07). Registers the shipments data layer. Shipment
 * assignment and delivery tracking arrive in Sprint 6.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Shipment.name, schema: ShipmentSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class TransportModule {}
