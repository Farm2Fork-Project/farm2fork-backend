import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dtos/pagination.dto';
import { OrderStatus } from '../schemas/order.schema';

export class QueryOrderDto extends PaginationDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    description: 'Admin only - filter by buyer id (ignored for other roles)',
  })
  @IsOptional()
  @IsMongoId()
  buyerId?: string;

  @ApiPropertyOptional({
    description: 'Admin only - filter by farmer id (ignored for other roles)',
  })
  @IsOptional()
  @IsMongoId()
  farmerId?: string;
}
