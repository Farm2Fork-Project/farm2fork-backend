import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dtos/pagination.dto';
import { PaymentGateway, PaymentStatus } from '../schemas/payment.schema';

export class QueryPaymentDto extends PaginationDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ enum: PaymentGateway })
  @IsOptional()
  @IsEnum(PaymentGateway)
  gateway?: PaymentGateway;
}
