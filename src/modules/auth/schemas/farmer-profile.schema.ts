import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type FarmerProfileDocument = HydratedDocument<FarmerProfile>;

@Schema({ _id: false })
export class FarmLocation {
  @Prop()
  lat?: number;

  @Prop()
  lng?: number;

  @Prop()
  address?: string;

  @Prop()
  city?: string;

  @Prop()
  province?: string;
}
const FarmLocationSchema = SchemaFactory.createForClass(FarmLocation);

@Schema({ _id: false })
export class Certification {
  @Prop()
  name?: string;

  @Prop()
  issuedBy?: string;

  @Prop()
  issuedDate?: Date;

  @Prop()
  expiryDate?: Date;

  @Prop()
  documentUrl?: string;
}
const CertificationSchema = SchemaFactory.createForClass(Certification);

/**
 * bankAccountDetails (master context 6.6) - financial credential.
 * select: false so it never leaves the DB unless explicitly requested; UI must
 * mask the account number when it is displayed.
 */
@Schema({ _id: false })
export class BankAccountDetails {
  @Prop()
  bankName?: string;

  @Prop()
  accountNumber?: string;

  @Prop()
  accountTitle?: string;
}
const BankAccountDetailsSchema =
  SchemaFactory.createForClass(BankAccountDetails);

@Schema({
  collection: 'farmer_profiles',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class FarmerProfile {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  farmName!: string;

  @Prop({ type: FarmLocationSchema })
  farmLocation?: FarmLocation;

  @Prop({ type: [String], default: [] })
  cropTypes!: string[];

  @Prop()
  landSizeAcres?: number;

  /** cnic (master context 6.6) - National ID, sensitive, never logged. */
  @Prop({ required: true, unique: true, index: true, select: false })
  cnic!: string;

  @Prop({ type: [CertificationSchema], default: [] })
  certifications!: Certification[];

  @Prop({ type: BankAccountDetailsSchema, select: false })
  bankAccountDetails?: BankAccountDetails;

  createdAt!: Date;
  updatedAt!: Date;
}

export const FarmerProfileSchema = SchemaFactory.createForClass(FarmerProfile);
