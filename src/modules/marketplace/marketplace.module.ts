import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { Product, ProductSchema } from './schemas/product.schema';

/**
 * MarketplaceModule (EP-02). Registers the products data layer and exposes the
 * listing/search/QR API surface backed by real Mongoose persistence.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
  ],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
  exports: [MongooseModule, MarketplaceService],
})
export class MarketplaceModule {}
