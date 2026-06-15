import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ProductUnit, QualityGrade } from '../schemas/product.schema';

export class CreateProductDto {
  @ApiProperty({ example: 'Roma Tomatoes', description: 'Product name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    example: 'vegetables',
    description: 'Category, e.g. vegetables | fruits | grains | dairy',
  })
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ApiPropertyOptional({ example: 'Fresh sun-ripened Roma tomatoes' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 120, description: 'Price per unit in PKR' })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({ example: 500, description: 'Available quantity' })
  @IsNumber()
  @Min(0)
  quantity!: number;

  @ApiProperty({ enum: ProductUnit, example: ProductUnit.Kg })
  @IsEnum(ProductUnit)
  unit!: ProductUnit;

  @ApiPropertyOptional({
    type: [String],
    description: 'Cloud storage image URLs',
    example: ['https://cdn.farm2fork.com/products/tomatoes-1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ enum: QualityGrade, example: QualityGrade.A })
  @IsOptional()
  @IsEnum(QualityGrade)
  qualityGrade?: QualityGrade;
}
