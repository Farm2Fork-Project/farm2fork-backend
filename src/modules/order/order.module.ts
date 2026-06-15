import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { Order, OrderSchema } from './schemas/order.schema';

/**
 * OrderModule (EP-04). Registers the orders data layer and exposes the order
 * API surface. Endpoints currently return DTO-shaped mock data; real
 * persistence + the One-Order-One-Farmer rule (§6.1) land in Sprint 3.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [MongooseModule, OrderService],
})
export class OrderModule {}
