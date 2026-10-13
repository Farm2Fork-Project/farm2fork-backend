import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentGateway, PaymentStatus } from '../schemas/payment.schema';

/**
 * Client-safe payment view. Deliberately omits `gatewayRef` - it is a sensitive
 * gateway internal reference that must never reach non-admin clients (§6.6).
 */
export class PaymentResponseDto {
  @ApiProperty({ example: '6a2fe77bb77795516febc600' })
  id!: string;

  @ApiProperty({ example: '6a2fe77bb77795516febc500' })
  orderId!: string;

  @ApiProperty({ example: '6a2fe77bb77795516febc222' })
  buyerId!: string;

  @ApiProperty({
    example: 1260,
    description: 'grandTotal from the order (PKR)',
  })
  amount!: number;

  @ApiProperty({ example: 'PKR' })
  currency!: string;

  @ApiProperty({ enum: PaymentGateway, example: PaymentGateway.JazzCash })
  gateway!: PaymentGateway;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.Pending })
  status!: PaymentStatus;

  @ApiPropertyOptional({
    example: '6a2fe77bb77795516febc999',
    description: 'Blockchain record id, set after a successful payment (§6.4)',
  })
  blockchainTxId?: string;

  @ApiPropertyOptional({ example: '2026-06-15T12:10:00.000Z' })
  paidAt?: string;

  @ApiPropertyOptional()
  failedAt?: string;

  @ApiPropertyOptional()
  refundedAt?: string;

  @ApiProperty({ example: '2026-06-15T12:05:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-06-15T12:05:00.000Z' })
  updatedAt!: string;
}
