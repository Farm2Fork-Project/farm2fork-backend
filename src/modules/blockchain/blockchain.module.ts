import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  BlockchainTransaction,
  BlockchainTransactionSchema,
} from './schemas/blockchain-transaction.schema';

/**
 * BlockchainModule (EP-03). Registers the blockchain_transactions data layer.
 * Hyperledger Fabric SDK calls and async retry logic arrive in Sprint 4.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BlockchainTransaction.name, schema: BlockchainTransactionSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class BlockchainModule {}
