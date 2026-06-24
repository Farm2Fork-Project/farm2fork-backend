import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { PaymentGateway } from '../schemas/payment.schema';

/** POST /payments - initiate payment for an existing order. */
export class CreatePaymentDto {
  @ApiProperty({ example: '6a2fe77bb77795516febc500' })
  @IsMongoId()
  orderId!: string;

  @ApiProperty({ enum: PaymentGateway, example: PaymentGateway.JazzCash })
  @IsEnum(PaymentGateway)
  gateway!: PaymentGateway;
}
