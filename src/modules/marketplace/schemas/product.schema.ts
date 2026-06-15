import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ProductDocument = HydratedDocument<Product>;

export enum ProductUnit {
  Kg = 'kg',
  Ton = 'ton',
  Dozen = 'dozen',
  Piece = 'piece',
  Litre = 'litre',
}

export enum QualityGrade {
  A = 'A',
  B = 'B',
  C = 'C',
}

export enum ProductStatus {
  Active = 'active',
  Inactive = 'inactive',
  SoldOut = 'sold_out',
}

/**
 * products (Collection 5.6).
 * NOTE: the first traceability record is referenced via initialBlockchainRecordId.
 * The old name blockchainTxId is retired (master context 15.1) - do not use it.
 */
@Schema({
  collection: 'products',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class Product {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  farmerId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  category!: string;

  @Prop()
  description?: string;

  /** Per unit in PKR. */
  @Prop({ required: true, min: 0 })
  price!: number;

  @Prop({ required: true, min: 0 })
  quantity!: number;

  @Prop({ required: true, type: String, enum: ProductUnit })
  unit!: ProductUnit;

  @Prop({ type: [String], default: [] })
  images!: string[];

  @Prop({ type: String, enum: QualityGrade })
  qualityGrade?: QualityGrade;

  /** Generated traceability URL - unique. */
  @Prop({ unique: true, sparse: true, index: true })
  qrCode?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BlockchainTransaction' })
  initialBlockchainRecordId?: Types.ObjectId;

  @Prop({
    required: true,
    type: String,
    enum: ProductStatus,
    default: ProductStatus.Active,
  })
  status!: ProductStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

// Critical index (master context 5.18): products by farmerId + status.
ProductSchema.index({ farmerId: 1, status: 1 });
