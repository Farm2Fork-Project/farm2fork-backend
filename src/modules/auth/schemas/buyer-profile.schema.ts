import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type BuyerProfileDocument = HydratedDocument<BuyerProfile>;

export enum BusinessType {
  Individual = 'individual',
  Retailer = 'retailer',
  Restaurant = 'restaurant',
  Wholesaler = 'wholesaler',
}

@Schema({ _id: false })
export class BuyerAddress {
  @Prop()
  label?: string;

  @Prop()
  street?: string;

  @Prop()
  city?: string;

  @Prop()
  province?: string;

  @Prop()
  zip?: string;

  @Prop({ default: false })
  isDefault!: boolean;
}
const BuyerAddressSchema = SchemaFactory.createForClass(BuyerAddress);

@Schema({
  collection: 'buyer_profiles',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class BuyerProfile {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  businessName!: string;

  @Prop({ required: true, type: String, enum: BusinessType })
  businessType!: BusinessType;

  @Prop({ type: [BuyerAddressSchema], default: [] })
  addresses!: BuyerAddress[];

  /** cnic (master context 6.6) - National ID, sensitive. */
  @Prop({ required: true, unique: true, index: true, select: false })
  cnic!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const BuyerProfileSchema = SchemaFactory.createForClass(BuyerProfile);
