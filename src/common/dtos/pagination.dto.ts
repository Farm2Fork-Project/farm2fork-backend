import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min, Max } from 'class-validator';

export class PaginationDto {
  @ApiProperty({
    description: 'Page number',
    default: 1,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  page: number = 1;

  @ApiProperty({
    description: 'Items per page',
    default: 10,
    minimum: 1,
    maximum: 100,
  })
  @IsNumber()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export class FilterDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Search query',
  })
  @IsOptional()
  search?: string;
}
