import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from './schemas/order.schema';

/**
 * OrderModule (EP-04). Registers the orders data layer. Order creation with the
 * One-Order-One-Farmer rule (master context 6.1) arrives in Sprint 3.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
  ],
  exports: [MongooseModule],
})
export class OrderModule {}
