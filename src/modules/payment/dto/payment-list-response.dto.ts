import { ApiProperty } from '@nestjs/swagger';
import { PaymentResponseDto } from './payment-response.dto';

export class PaymentListResponseDto {
  @ApiProperty({ type: [PaymentResponseDto] })
  data!: PaymentResponseDto[];

  @ApiProperty({ example: 8 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}
