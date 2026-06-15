import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { QualityGrade } from '../../marketplace/schemas/product.schema';

export type AiPredictionDocument = HydratedDocument<AiPrediction>;

export enum PredictionType {
  Price = 'price',
  Quality = 'quality',
}

@Schema({ _id: false })
export class PredictionInput {
  @Prop()
  productName?: string;

  @Prop()
  category?: string;

  @Prop()
  quantity?: number;

  @Prop()
  unit?: string;

  @Prop()
  location?: string;

  @Prop()
  season?: string;
}
const PredictionInputSchema = SchemaFactory.createForClass(PredictionInput);

/**
 * ai_predictions (Collection 5.16).
 * Immutable record - createdAt only, no updatedAt. Every prediction is stored
 * regardless of whether it came from the ML model or the rule-based fallback;
 * modelVersion distinguishes them (master context 10.3).
 */
@Schema({
  collection: 'ai_predictions',
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.__v;
      return ret;
    },
  },
})
export class AiPrediction {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product' })
  productId?: Types.ObjectId;

  @Prop({ required: true, type: String, enum: PredictionType })
  predictionType!: PredictionType;

  @Prop({ type: PredictionInputSchema })
  inputData?: PredictionInput;

  /** PKR - populated for price predictions. */
  @Prop()
  predictedMinPrice?: number;

  @Prop()
  predictedMaxPrice?: number;

  /** Populated for quality predictions. */
  @Prop({ type: String, enum: QualityGrade })
  qualityGrade?: QualityGrade;

  /** 0.0 to 1.0. */
  @Prop({ min: 0, max: 1 })
  confidenceScore?: number;

  /** e.g. 'price-v1.2' - tracked for model evaluation. */
  @Prop()
  modelVersion?: string;

  createdAt!: Date;
}

export const AiPredictionSchema = SchemaFactory.createForClass(AiPrediction);

// Critical index (master context 5.18).
AiPredictionSchema.index({ userId: 1, productId: 1 });
