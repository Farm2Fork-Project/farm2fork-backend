import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RateListDocument = HydratedDocument<RateList>;

export enum RateListStatus {
  /** Uploaded and parsed, waiting for an admin to check and publish. */
  Draft = 'draft',
  Published = 'published',
  Withdrawn = 'withdrawn',
}

/** Units a mandi rate list quotes in. Weight units convert to each other. */
export const RATE_UNITS = [
  'kg',
  '40kg',
  '100kg',
  'ton',
  'dozen',
  'piece',
  'litre',
] as const;
export type RateUnit = (typeof RATE_UNITS)[number];

@Schema({ _id: false })
export class RateEntry {
  @Prop({ required: true, trim: true })
  commodity!: string;

  @Prop({ required: true, type: String, enum: RATE_UNITS })
  unit!: RateUnit;

  @Prop({ required: true, min: 0 })
  minPrice!: number;

  @Prop({ required: true, min: 0 })
  maxPrice!: number;

  /** Fair-quality price, when the list gives one. */
  @Prop({ min: 0 })
  fairPrice?: number;
}
const RateEntrySchema = SchemaFactory.createForClass(RateEntry);

/**
 * rate_lists: an official market rate list for one market and one trading
 * day, uploaded by an admin. The list is a dated document: it is never
 * edited in place, only published, withdrawn or superseded by a newer one.
 */
@Schema({ collection: 'rate_lists', timestamps: true })
export class RateList {
  /** Trading day the prices were observed, at UTC midnight. */
  @Prop({ required: true })
  tradingDate!: Date;

  @Prop({ required: true, trim: true })
  market!: string;

  /** Issuing body, e.g. "Market Committee Lahore" or "AMIS Punjab". */
  @Prop({ required: true, trim: true })
  source!: string;

  @Prop({ required: true, trim: true })
  sourceUrl!: string;

  @Prop({ type: [RateEntrySchema], default: [] })
  entries!: RateEntry[];

  @Prop({
    required: true,
    type: String,
    enum: RateListStatus,
    default: RateListStatus.Draft,
  })
  status!: RateListStatus;

  @Prop({ trim: true })
  fileName?: string;

  /** Private storage reference of the scanned original, when attached. */
  @Prop({ select: false })
  documentRef?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: Types.ObjectId;

  @Prop()
  publishedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const RateListSchema = SchemaFactory.createForClass(RateList);
RateListSchema.index({ status: 1, tradingDate: -1 });
RateListSchema.index({ market: 1, status: 1, tradingDate: -1 });
