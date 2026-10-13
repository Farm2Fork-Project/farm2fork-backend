import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentResponseDto } from './payment-response.dto';

/** Result of creating or resuming a persisted payment. */
export class InitiatePaymentResponseDto {
  @ApiProperty({ type: PaymentResponseDto })
  payment!: PaymentResponseDto;

  @ApiPropertyOptional({
    example:
      'https://sandbox.api.getsafepay.com/embedded/?environment=sandbox&tracker=...',
    description:
      'Hosted checkout URL to open (gateway === safepay only). Open in a ' +
      'webview/browser tab; the buyer completes payment there.',
  })
  checkoutUrl?: string;
}
