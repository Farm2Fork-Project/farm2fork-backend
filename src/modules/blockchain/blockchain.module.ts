import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BlockchainTransaction,
  BlockchainTransactionSchema,
} from './schemas/blockchain-transaction.schema';
import {
  FABRIC_GATEWAY_CLIENT,
  FABRIC_GATEWAY_RUNTIME,
} from './interfaces/fabric-gateway-client.interface';
import { FabricGatewayService } from './fabric-gateway.service';
import { FabricGatewayRuntimeService } from './fabric-gateway.runtime';

/**
 * BlockchainModule (EP-03). Registers the blockchain_transactions data layer.
 * The production Fabric Gateway client is registered here. The worker that
 * consumes records is deliberately separate so disabled deployments never
 * attempt Fabric I/O.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlockchainTransaction.name, schema: BlockchainTransactionSchema },
    ]),
  ],
  providers: [
    FabricGatewayRuntimeService,
    {
      provide: FABRIC_GATEWAY_RUNTIME,
      useExisting: FabricGatewayRuntimeService,
    },
    FabricGatewayService,
    { provide: FABRIC_GATEWAY_CLIENT, useExisting: FabricGatewayService },
  ],
  exports: [MongooseModule, FABRIC_GATEWAY_CLIENT],
})
export class BlockchainModule {}
