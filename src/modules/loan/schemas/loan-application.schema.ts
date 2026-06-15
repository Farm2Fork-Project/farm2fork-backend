import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type LoanApplicationDocument = HydratedDocument<LoanApplication>;

export enum LoanStatus {
  Pending = 'pending',
  UnderReview = 'under_review',
  Approved = 'approved',
  Rejected = 'rejected',
  Repaid = 'repaid',
}

@Schema({ _id: false })
export class RepaymentInstallment {
  @Prop({ required: true })
  dueDate!: Date;

  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ default: false })
  isPaid!: boolean;

  @Prop()
  paidAt?: Date;
}
const RepaymentInstallmentSchema =
  SchemaFactory.createForClass(RepaymentInstallment);

/**
 * loan_applications (Collection 5.11).
 * applicantId role MUST be farmer (master context 6.3) - enforced in
 * LoanService. documents URLs are sensitive (CNIC / land documents).
 */
@Schema({
  collection: 'loan_applications',
  timestamps: true,
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class LoanApplication {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  applicantId!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ required: true })
  purpose!: string;

  @Prop({ required: true, min: 1 })
  durationMonths!: number;

  @Prop({
    required: true,
    type: String,
    enum: LoanStatus,
    default: LoanStatus.Pending,
  })
  status!: LoanStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop()
  reviewNote?: string;

  /** documents (master context 6.6) - sensitive uploaded file URLs. */
  @Prop({ type: [String], default: [], select: false })
  documents!: string[];

  @Prop({ type: [RepaymentInstallmentSchema], default: [] })
  repaymentSchedule!: RepaymentInstallment[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const LoanApplicationSchema =
  SchemaFactory.createForClass(LoanApplication);
