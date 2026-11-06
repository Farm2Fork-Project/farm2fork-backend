import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  ProductUnit,
  QualityGrade,
} from '../../marketplace/schemas/product.schema';

/** Crops supported by the current quality suggestion model. */
export const GRADABLE_CROPS = ['wheat', 'rice', 'mango', 'maize'] as const;
export type GradableCrop = (typeof GRADABLE_CROPS)[number];

export type ReviewReason =
  | 'low_confidence'
  | 'unfamiliar_photo'
  | 'photo_check_unavailable'
  | 'unsupported_crop'
  | 'untrained_model';

export type ModelStatus = 'trained' | 'untrained';

export class QualityCheckRequestDto {
  @ApiProperty({ enum: GRADABLE_CROPS, example: 'mango' })
  @IsIn(GRADABLE_CROPS, {
    message:
      'Quality suggestions are available only for wheat, rice, mango and maize. Choose a listing grade manually for other crops.',
  })
  crop!: GradableCrop;
}

export class QualityCheckResponseDto {
  @ApiProperty({ description: 'Stored ai_predictions id' })
  predictionId!: string;

  @ApiProperty({ enum: ['A', 'B', 'C', 'D'], description: 'Raw model grade' })
  modelGrade!: 'A' | 'B' | 'C' | 'D';

  @ApiPropertyOptional({
    enum: QualityGrade,
    nullable: true,
    description:
      'Optional grade suggestion for the selected supported crop; null for unsupported output or D (below listable grades).',
  })
  suggestedListingGrade!: QualityGrade | null;

  @ApiProperty()
  needsReview!: boolean;

  @ApiProperty({
    nullable: true,
    enum: [
      'low_confidence',
      'unfamiliar_photo',
      'photo_check_unavailable',
      'unsupported_crop',
      'untrained_model',
    ],
  })
  reviewReason!: ReviewReason | null;

  @ApiProperty({ nullable: true, type: Number })
  photoSimilarity!: number | null;

  @ApiProperty({ example: 0.82 })
  confidenceScore!: number;

  @ApiProperty({ example: { A: 0.82, B: 0.1, C: 0.05, D: 0.03 } })
  probabilities!: Record<string, number>;

  @ApiProperty({ enum: GRADABLE_CROPS })
  crop!: GradableCrop;

  @ApiProperty({
    description: 'False when the model has no training data for this crop yet.',
  })
  cropSupported!: boolean;

  @ApiProperty()
  lowConfidence!: boolean;

  @ApiProperty({
    enum: ['trained', 'untrained'],
    description:
      'untrained = preview output from a model without trained weights; clients must not present it as an assessment.',
  })
  modelStatus!: ModelStatus;

  @ApiProperty({ example: 'grade-cond-efficientnet_b0-1a2b3c4d' })
  modelVersion!: string;
}

export class PriceSuggestionRequestDto {
  @ApiProperty({ example: 'Chaunsa Mangoes' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  productName!: string;

  @ApiProperty({ example: 'fruits' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  category!: string;

  @ApiProperty({ enum: ProductUnit, example: ProductUnit.Kg })
  @IsEnum(ProductUnit)
  unit!: ProductUnit;

  @ApiPropertyOptional({ example: 400 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  quantity?: number;

  @ApiPropertyOptional({ enum: QualityGrade })
  @IsOptional()
  @IsEnum(QualityGrade)
  qualityGrade?: QualityGrade;
}

export class PriceSuggestionResponseDto {
  @ApiProperty()
  predictionId!: string;

  @ApiProperty({ example: 272, description: 'PKR per unit' })
  predictedMinPrice!: number;

  @ApiProperty({ example: 380, description: 'PKR per unit' })
  predictedMaxPrice!: number;

  @ApiProperty({ enum: ProductUnit })
  unit!: ProductUnit;

  @ApiProperty({ enum: ['official_wholesale'] })
  method!: 'official_wholesale';

  @ApiProperty({ enum: ['PKR'] })
  currency!: 'PKR';

  @ApiProperty()
  modelVersion!: string;

  @ApiProperty()
  commodity!: string;

  @ApiProperty({ example: '2026-10-28' })
  observedOn!: string;

  @ApiProperty()
  marketScope!: string;

  @ApiProperty()
  marketCount!: number;

  @ApiProperty()
  source!: string;

  @ApiProperty()
  sourceUrl!: string;
}

export class AiStatusResponseDto {
  @ApiProperty({
    description: 'Whether the AI service answered its health check.',
  })
  available!: boolean;

  @ApiPropertyOptional({ enum: ['trained', 'untrained', 'unavailable'] })
  qualityModel?: 'trained' | 'untrained' | 'unavailable';

  @ApiPropertyOptional({ type: [String] })
  trainedCrops?: string[];

  @ApiPropertyOptional({ example: 'rule_based' })
  priceMethod?: string;
}
