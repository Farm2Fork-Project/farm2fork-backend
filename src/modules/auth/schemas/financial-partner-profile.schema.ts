import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type FinancialPartnerProfileDocument =
  HydratedDocument<FinancialPartnerProfile>;

export enum InstitutionType {
  Bank = 'bank',
  Microfinance = 'microfinance',
  Ngo = 'ngo',
  Government = 'government',
}

@Schema({
  collection: 'financial_partner_profiles',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class FinancialPartnerProfile {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  institutionName!: string;

  @Prop({ required: true, type: String, enum: InstitutionType })
  institutionType!: InstitutionType;

  /** licenseNumber (master context 6.6) - regulatory license, sensitive. */
  @Prop({ required: true, select: false })
  licenseNumber!: string;

  /** cnic (master context 6.6) - National ID, sensitive. */
  @Prop({ required: true, unique: true, index: true, select: false })
  cnic!: string;

  @Prop({ trim: true })
  designation?: string;

  /** Max loan amount this partner can approve (PKR). */
  @Prop()
  approvalLimit?: number;

  @Prop({ type: [String], default: [] })
  serviceRegions!: string[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const FinancialPartnerProfileSchema = SchemaFactory.createForClass(
  FinancialPartnerProfile,
);
