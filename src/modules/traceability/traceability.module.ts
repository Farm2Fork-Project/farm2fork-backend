import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { OrderModule } from '../order/order.module';
import { TraceabilityController } from './traceability.controller';
import { TraceabilityService } from './traceability.service';

/**
 * TraceabilityModule (EP-03). Read-only, public provenance projection over
 * the products, orders and blockchain outbox collections.
 */
@Module({
  imports: [AuthModule, BlockchainModule, MarketplaceModule, OrderModule],
  controllers: [TraceabilityController],
  providers: [TraceabilityService],
})
export class TraceabilityModule {}
