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

export type ModelStatus = 'trained' | 'untrained';

export class QualityCheckRequestDto {
  @ApiProperty({ enum: GRADABLE_CROPS, example: 'mango' })
  @IsIn(GRADABLE_CROPS, {
    message:
      'Quality suggestions are available only for wheat, rice, mango and maize. Choose a listing grade manually for other crops.',
  })
  crop!: GradableCrop;
}

export const QUALITY_REVIEW_REASONS = [
  'low_confidence',
  'unfamiliar_photo',
  'photo_check_unavailable',
] as const;
export type QualityReviewReason = (typeof QUALITY_REVIEW_REASONS)[number];

export class QualityCheckResponseDto {
  @ApiProperty({ description: 'Stored ai_predictions id' })
  predictionId!: string;

  @ApiProperty({
    enum: ['A', 'B', 'C', 'D'],
    nullable: true,
    description: 'Raw model grade; null when the photo needs review.',
  })
  modelGrade!: 'A' | 'B' | 'C' | 'D' | null;

  @ApiPropertyOptional({
    enum: QualityGrade,
    nullable: true,
    description:
      'Optional grade suggestion for the selected supported crop; null for unsupported output or D (below listable grades).',
  })
  suggestedListingGrade!: QualityGrade | null;

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
    description:
      'True when no grade can be shown: ask the farmer to retake the photo or choose the grade manually.',
  })
  needsReview!: boolean;

  @ApiPropertyOptional({ enum: QUALITY_REVIEW_REASONS, nullable: true })
  reviewReason!: QualityReviewReason | null;

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

  @ApiProperty({
    enum: ['official_wholesale'],
    description:
      'Observed AMIS Punjab wholesale mandi prices for a dated trading day, not a prediction.',
  })
  method!: 'official_wholesale';

  @ApiProperty({ example: 'Wheat', description: 'Official commodity name(s)' })
  commodity!: string;

  @ApiProperty({ example: '2026-10-22', description: 'Mandi trading day' })
  observedOn!: string;

  @ApiProperty({
    example: 'Faisalabad',
    description:
      "The farmer's own market, or Punjab for the middle half of markets",
  })
  marketScope!: string;

  @ApiProperty({ example: 13 })
  marketCount!: number;

  @ApiProperty({ example: 'AMIS Punjab' })
  source!: string;

  @ApiProperty({ example: 'http://www.amis.pk' })
  sourceUrl!: string;

  @ApiProperty({ example: 'amis-punjab-2026-10-22' })
  modelVersion!: string;
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

  @ApiPropertyOptional({ example: 'official_wholesale' })
  priceMethod?: string;
}
