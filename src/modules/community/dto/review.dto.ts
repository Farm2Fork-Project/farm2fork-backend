import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({ description: 'A delivered order you placed' })
  @IsMongoId()
  orderId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ example: 'Fresh, well packed and on time.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ReviewReplyDto {
  @ApiProperty({ example: 'Thank you, glad the mangoes arrived well.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reply!: string;
}

export class QueryReviewsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ReviewResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderId!: string;
  @ApiProperty() farmerId!: string;
  @ApiProperty({ description: 'Buyer business name, never an email' })
  buyerName!: string;
  @ApiProperty({ type: [String] }) productNames!: string[];
  @ApiProperty() rating!: number;
  @ApiPropertyOptional() comment?: string;
  @ApiPropertyOptional() farmerReply?: string;
  @ApiPropertyOptional() farmerRepliedAt?: string;
  @ApiProperty() createdAt!: string;
}

export class RatingSummaryDto {
  @ApiProperty({ description: 'Mean rating to one decimal, 0 when unrated' })
  average!: number;
  @ApiProperty() count!: number;
  @ApiProperty({
    type: [Number],
    description: 'How many reviews gave 1, 2, 3, 4 and 5 stars',
  })
  distribution!: number[];
}

export class ReviewPageDto {
  @ApiProperty({ type: RatingSummaryDto }) summary!: RatingSummaryDto;
  @ApiProperty({ type: [ReviewResponseDto] }) data!: ReviewResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
