import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dtos/pagination.dto';
import {
  ProductStatus,
  ProductUnit,
  QualityGrade,
} from '../schemas/product.schema';

export enum ProductSortBy {
  CreatedAt = 'createdAt',
  Price = 'price',
  Name = 'name',
}

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}

/** Search/filter parameters for GET /products (extends page/limit). */
export class QueryProductDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Free-text search on product name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'vegetables' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: ProductUnit })
  @IsOptional()
  @IsEnum(ProductUnit)
  unit?: ProductUnit;

  @ApiPropertyOptional({ enum: QualityGrade })
  @IsOptional()
  @IsEnum(QualityGrade)
  qualityGrade?: QualityGrade;

  @ApiPropertyOptional({
    enum: ProductStatus,
    description: 'Filter by listing status',
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ description: 'Filter by owning farmer id' })
  @IsOptional()
  @IsString()
  farmerId?: string;

  @ApiPropertyOptional({ example: 50, description: 'Minimum price in PKR' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 500, description: 'Maximum price in PKR' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    description:
      'Only listings whose origin record is confirmed on the ledger. Applied before pagination.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  verifiedOrigin?: boolean;

  @ApiPropertyOptional({
    enum: ProductSortBy,
    default: ProductSortBy.CreatedAt,
  })
  @IsOptional()
  @IsEnum(ProductSortBy)
  sortBy?: ProductSortBy = ProductSortBy.CreatedAt;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.Desc })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.Desc;
}
