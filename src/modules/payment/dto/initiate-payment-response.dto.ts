import { ApiProperty } from '@nestjs/swagger';
import { PaymentResponseDto } from './payment-response.dto';

/** Result of creating or resuming a persisted payment. */
export class InitiatePaymentResponseDto {
  @ApiProperty({ type: PaymentResponseDto })
  payment!: PaymentResponseDto;
}
