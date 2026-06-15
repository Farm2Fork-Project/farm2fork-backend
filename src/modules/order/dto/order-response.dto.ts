import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../schemas/order.schema';
import { OrderAddressDto } from './create-order.dto';

export class OrderItemResponseDto {
  @ApiProperty({ example: '6a2fe77bb77795516febc287' })
  productId!: string;

  @ApiProperty({ example: '6a2fe77bb77795516febc111' })
  farmerId!: string;

  @ApiProperty({
    example: 'Roma Tomatoes',
    description: 'Snapshot at order time',
  })
  productName!: string;

  @ApiProperty({ example: 10 })
  quantity!: number;

  @ApiProperty({ example: 120, description: 'Snapshot unit price in PKR' })
  unitPrice!: number;

  @ApiProperty({ example: 1200 })
  subtotal!: number;
}

export class OrderResponseDto {
  @ApiProperty({ example: '6a2fe77bb77795516febc500' })
  id!: string;

  @ApiProperty({ example: '6a2fe77bb77795516febc222' })
  buyerId!: string;

  @ApiProperty({
    example: '6a2fe77bb77795516febc111',
    description: 'The single farmer for the whole order (§6.1)',
  })
  farmerId!: string;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({ example: 1200, description: 'Sum of item subtotals (PKR)' })
  totalAmount!: number;

  @ApiProperty({ example: 5, description: 'Platform fee % snapshot (§6.2)' })
  platformFeePercent!: number;

  @ApiProperty({
    example: 60,
    description: 'totalAmount × platformFeePercent/100',
  })
  platformFeeAmount!: number;

  @ApiProperty({
    example: 1260,
    description: 'totalAmount + platformFeeAmount',
  })
  grandTotal!: number;

  @ApiProperty({ type: OrderAddressDto })
  shippingAddress!: OrderAddressDto;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.Pending })
  status!: OrderStatus;

  @ApiPropertyOptional({ example: '6a2fe77bb77795516febc600' })
  paymentId?: string;

  @ApiPropertyOptional({ example: '6a2fe77bb77795516febc700' })
  shipmentId?: string;

  @ApiProperty({ example: '2026-06-15T12:04:54.745Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-06-15T12:04:54.745Z' })
  updatedAt!: string;
}
