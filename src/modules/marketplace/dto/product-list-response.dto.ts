import { ApiProperty } from '@nestjs/swagger';
import { ProductResponseDto } from './product-response.dto';

/** Paginated envelope for product collections. */
export class ProductListResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  data!: ProductResponseDto[];

  @ApiProperty({ example: 42, description: 'Total matching items' })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 5 })
  totalPages!: number;
}
