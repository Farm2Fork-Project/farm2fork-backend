import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type BlockchainTransactionDocument =
  HydratedDocument<BlockchainTransaction>;

export enum BlockchainTxType {
  Payment = 'payment',
  SupplyChainEvent = 'supply_chain_event',
}

export enum BlockchainReferenceModel {
  Payment = 'Payment',
  Shipment = 'Shipment',
  Product = 'Product',
}

export enum BlockchainTxStatus {
  Pending = 'pending',
  Confirmed = 'confirmed',
  Failed = 'failed',
}

/**
 * Typed payment payload (master context 5.9). Rule 15.6 forbids storing
 * blockchain payloads as raw untyped objects - this sub-document IS the typed
 * structure. Populated only for type: payment.
 */
@Schema({ _id: false })
export class PaymentPayload {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Order' })
  orderId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  buyerId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  farmerId?: Types.ObjectId;

  @Prop()
  amount?: number;

  @Prop()
  currency?: string;

  @Prop()
  gateway?: string;

  @Prop()
  paidAt?: Date;
}
const PaymentPayloadSchema = SchemaFactory.createForClass(PaymentPayload);

/**
 * Typed supply-chain payload (master context 5.9).
 * Populated only for type: supply_chain_event.
 */
@Schema({ _id: false })
export class SupplyChainPayload {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product' })
  productId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  farmerId?: Types.ObjectId;

  @Prop()
  eventType?: string;

  @Prop()
  location?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  actorId?: Types.ObjectId;

  @Prop()
  actorRole?: string;

  @Prop()
  timestamp?: Date;
}
const SupplyChainPayloadSchema =
  SchemaFactory.createForClass(SupplyChainPayload);

@Schema({ _id: false })
export class BlockchainPayload {
  @Prop({ type: PaymentPayloadSchema, default: null })
  payment!: PaymentPayload | null;

  @Prop({ type: SupplyChainPayloadSchema, default: null })
  supplyChain!: SupplyChainPayload | null;
}
const BlockchainPayloadSchema =
  SchemaFactory.createForClass(BlockchainPayload);

/**
 * blockchain_transactions (Collection 5.9).
 * Immutable record - createdAt only, no updatedAt. Raw payload must never be
 * exposed to buyer/farmer clients (master context 6.6 / 9.2 rule 15.6).
 */
@Schema({
  collection: 'blockchain_transactions',
  timestamps: { createdAt: true, updatedAt: false },
})
export class BlockchainTransaction {
  @Prop({ required: true, type: String, enum: BlockchainTxType })
  type!: BlockchainTxType;

  /** Polymorphic ref - Payment | Shipment | Product. */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  referenceId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: BlockchainReferenceModel })
  referenceModel!: BlockchainReferenceModel;

  /** Hyperledger Fabric transaction hash - unique. */
  @Prop({ unique: true, sparse: true, index: true })
  txHash?: string;

  @Prop()
  blockNumber?: number;

  @Prop()
  channelName?: string;

  @Prop({ type: BlockchainPayloadSchema, default: () => ({}) })
  payload!: BlockchainPayload;

  @Prop({
    required: true,
    type: String,
    enum: BlockchainTxStatus,
    default: BlockchainTxStatus.Pending,
  })
  status!: BlockchainTxStatus;

  @Prop({ default: 0, min: 0, max: 3 })
  retryCount!: number;

  createdAt!: Date;
}

export const BlockchainTransactionSchema = SchemaFactory.createForClass(
  BlockchainTransaction,
);
