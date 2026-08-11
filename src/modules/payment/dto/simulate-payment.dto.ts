import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PaymentStatus } from '../schemas/payment.schema';

/** Local-development payment outcome requested by the authenticated buyer. */
export class SimulatePaymentDto {
  @ApiProperty({
    enum: [PaymentStatus.Success, PaymentStatus.Failed],
    example: PaymentStatus.Success,
  })
  @IsIn([PaymentStatus.Success, PaymentStatus.Failed])
  status!: PaymentStatus.Success | PaymentStatus.Failed;
}
