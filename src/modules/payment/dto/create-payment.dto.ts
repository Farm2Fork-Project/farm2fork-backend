import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { PaymentGateway } from '../schemas/payment.schema';

export enum PaymentClient {
  Web = 'web',
  Mobile = 'mobile',
}

/** POST /payments - initiate payment for an existing order. */
export class CreatePaymentDto {
  @ApiProperty({ example: '6a2fe77bb77795516febc500' })
  @IsMongoId()
  orderId!: string;

  @ApiProperty({ enum: PaymentGateway, example: PaymentGateway.JazzCash })
  @IsEnum(PaymentGateway)
  gateway!: PaymentGateway;

  @ApiPropertyOptional({ enum: PaymentClient, default: PaymentClient.Web })
  @IsOptional()
  @IsEnum(PaymentClient)
  client?: PaymentClient;
}
