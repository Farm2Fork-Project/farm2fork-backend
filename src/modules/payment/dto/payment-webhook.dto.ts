import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Gateway callback payload (POST /payments/webhook/:gateway). Public endpoint -
 * the gateway, not the client, calls it. The real payload is gateway-specific
 * and signature-verified; this is a documented common shape.
 */
export class PaymentWebhookDto {
  @ApiProperty({
    example: 'TXN-9982211',
    description: 'Gateway transaction reference',
  })
  @IsString()
  gatewayRef!: string;

  @ApiProperty({
    example: 'success',
    description: 'Gateway-reported result, e.g. success | failed',
  })
  @IsString()
  status!: string;

  @ApiPropertyOptional({
    description: 'Signature/HMAC used to verify the callback authenticity',
  })
  @IsOptional()
  @IsString()
  signature?: string;
}
