import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { Order, OrderSchema } from '../order/schemas/order.schema';
import { FarmProfileController } from './farm-profile.controller';
import { FarmProfileService } from './farm-profile.service';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { Product, ProductSchema } from './schemas/product.schema';

/**
 * MarketplaceModule (EP-02). Registers the products data layer and exposes the
 * listing/search/QR API surface backed by real Mongoose persistence.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
    AuthModule,
    BlockchainModule,
  ],
  controllers: [MarketplaceController, FarmProfileController],
  providers: [MarketplaceService, FarmProfileService],
  exports: [MongooseModule, MarketplaceService],
})
export class MarketplaceModule {}
