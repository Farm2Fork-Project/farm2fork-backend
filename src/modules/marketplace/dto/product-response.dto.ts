import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ProductStatus,
  ProductUnit,
  QualityGrade,
} from '../schemas/product.schema';

export class ProductResponseDto {
  @ApiProperty({ example: '6a2fe77bb77795516febc287' })
  id!: string;

  @ApiProperty({
    example: '6a2fe77bb77795516febc111',
    description: 'Owning farmer user id',
  })
  farmerId!: string;

  @ApiProperty({ example: 'Roma Tomatoes' })
  name!: string;

  @ApiProperty({ example: 'vegetables' })
  category!: string;

  @ApiPropertyOptional({ example: 'Fresh sun-ripened Roma tomatoes' })
  description?: string;

  @ApiProperty({ example: 120, description: 'Price per unit in PKR' })
  price!: number;

  @ApiProperty({ example: 500 })
  quantity!: number;

  @ApiProperty({ enum: ProductUnit, example: ProductUnit.Kg })
  unit!: ProductUnit;

  @ApiProperty({
    type: [String],
    example: ['https://cdn.farm2fork.com/products/tomatoes-1.jpg'],
  })
  images!: string[];

  @ApiPropertyOptional({ enum: QualityGrade, example: QualityGrade.A })
  qualityGrade?: QualityGrade;

  @ApiPropertyOptional({
    example: 'https://farm2fork.com/trace/6a2fe77bb77795516febc287',
    description: 'Traceability QR code URL',
  })
  qrCode?: string;

  @ApiPropertyOptional({
    example: '6a2fe77bb77795516febc999',
    description: 'First blockchain traceability record id',
  })
  initialBlockchainRecordId?: string;

  @ApiProperty({ enum: ProductStatus, example: ProductStatus.Active })
  status!: ProductStatus;

  @ApiProperty({ example: '2026-06-15T11:52:27.282Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-06-15T11:52:27.282Z' })
  updatedAt!: string;
}
