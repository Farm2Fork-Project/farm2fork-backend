import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminModule } from '../admin/admin.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { Order, OrderSchema } from './schemas/order.schema';

/**
 * OrderModule (EP-04). Registers the orders data layer and exposes the order
 * API surface with real persistence and the One-Order-One-Farmer rule (§6.1)
 * enforced in OrderService. Imports MarketplaceModule for product lookup and
 * AdminModule for the platform-fee ConfigService (§6.2).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    MarketplaceModule,
    AdminModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [MongooseModule, OrderService],
})
export class OrderModule {}
