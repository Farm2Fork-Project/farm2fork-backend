import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsNumber, Min } from 'class-validator';
import { ProductStatus } from '../schemas/product.schema';
import { CreateProductDto } from './create-product.dto';

/**
 * All create fields become optional. `status` is additionally updatable so a
 * farmer can mark a listing inactive or sold_out.
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional({ enum: ProductStatus, example: ProductStatus.Inactive })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    description: 'Stock observed when editing; prevents overwriting sales.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  expectedQuantity?: number;
}
