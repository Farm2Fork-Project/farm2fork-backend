import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../schemas/order.schema';

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

export class OrderAddressResponseDto {
  @ApiProperty() street!: string;
  @ApiProperty() city!: string;
  @ApiProperty() province!: string;
  @ApiPropertyOptional() zip?: string;
  @ApiPropertyOptional({ description: 'Absent on legacy orders' }) lat?: number;
  @ApiPropertyOptional({ description: 'Absent on legacy orders' }) lng?: number;
}

export class OrderQuoteResponseDto {
  @ApiProperty({ example: 1200 }) totalAmount!: number;
  @ApiProperty({ example: 5 }) platformFeePercent!: number;
  @ApiProperty({ example: 60 }) platformFeeAmount!: number;
  @ApiProperty({ example: 450 }) deliveryFee!: number;
  @ApiProperty({ example: 12.4 }) deliveryDistanceKm!: number;
  @ApiProperty({ example: 1710 }) grandTotal!: number;
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
    example: 450,
    description:
      'Fixed delivery price frozen at checkout (0 on legacy orders): base + per-km x estimated road distance',
  })
  deliveryFee!: number;

  @ApiPropertyOptional({ example: 12.4 })
  deliveryDistanceKm?: number;

  @ApiProperty({
    example: 1710,
    description: 'totalAmount + platformFeeAmount + deliveryFee',
  })
  grandTotal!: number;

  @ApiProperty({ type: OrderAddressResponseDto })
  shippingAddress!: OrderAddressResponseDto;

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
