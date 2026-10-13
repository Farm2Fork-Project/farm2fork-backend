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

/** Crops the grading model knows (farm2fork-ai constants.CROP_CLASSES). */
export const GRADABLE_CROPS = [
  'wheat',
  'rice',
  'mango',
  'maize',
  'cotton',
  'sugarcane',
] as const;
export type GradableCrop = (typeof GRADABLE_CROPS)[number];

export type ModelStatus = 'trained' | 'untrained';

export class QualityCheckRequestDto {
  @ApiProperty({ enum: GRADABLE_CROPS, example: 'mango' })
  @IsIn(GRADABLE_CROPS)
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
      'Grade to pre-fill on a listing; null when the model says D (below listable grades).',
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

  @ApiProperty({ example: 0.45 })
  confidenceScore!: number;

  @ApiProperty({
    enum: ['rule_based'],
    description:
      'rule_based = reference ranges x season x grade (master context 10.3), not a market-data model.',
  })
  method!: 'rule_based';

  @ApiProperty({ enum: ['crop', 'category'] })
  basis!: 'crop' | 'category';

  @ApiProperty({ example: 'price-rules-v1' })
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

  @ApiPropertyOptional({ example: 'rule_based' })
  priceMethod?: string;
}
