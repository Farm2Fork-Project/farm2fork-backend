import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from './schemas/product.schema';

/**
 * MarketplaceModule (EP-02). Currently registers the products data layer.
 * Listings, search, filter and QR generation arrive in Sprint 2.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
  ],
  exports: [MongooseModule],
})
export class MarketplaceModule {}
