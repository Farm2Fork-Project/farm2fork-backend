import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentResponseDto } from './payment-response.dto';

/**
 * Result of initiating a payment. The gateway-specific field tells the client
 * how to complete the charge: JazzCash returns a hosted `redirectUrl`, Stripe
 * returns a `clientSecret` for its SDK.
 */
export class InitiatePaymentResponseDto {
  @ApiProperty({ type: PaymentResponseDto })
  payment!: PaymentResponseDto;

  @ApiPropertyOptional({
    example: 'https://sandbox.jazzcash.com.pk/pay/6a2fe77bb77795516febc600',
    description: 'JazzCash hosted checkout URL to redirect the buyer to',
  })
  redirectUrl?: string;

  @ApiPropertyOptional({
    example: 'pi_3Q...secret_abc',
    description: 'Stripe PaymentIntent client secret',
  })
  clientSecret?: string;
}
