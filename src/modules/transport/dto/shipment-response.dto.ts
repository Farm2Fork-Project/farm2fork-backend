import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShipmentStatus } from '../schemas/shipment.schema';

export class ShipmentAddressResponseDto {
  @ApiPropertyOptional()
  street?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional()
  province?: string;

  @ApiPropertyOptional()
  zip?: string;
}

export class ShipmentStatusHistoryResponseDto {
  @ApiProperty({ enum: ShipmentStatus })
  status!: ShipmentStatus;

  @ApiProperty()
  timestamp!: string;

  @ApiPropertyOptional()
  note?: string;

  @ApiPropertyOptional()
  updatedBy?: string;
}

/** Full address view returned only after the caller has passed shipment scope checks. */
export class ShipmentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  transporterId!: string;

  @ApiProperty({ enum: ShipmentStatus })
  status!: ShipmentStatus;

  @ApiProperty({ type: ShipmentAddressResponseDto })
  pickupAddress!: ShipmentAddressResponseDto;

  @ApiProperty({ type: ShipmentAddressResponseDto })
  deliveryAddress!: ShipmentAddressResponseDto;

  @ApiProperty({ type: [ShipmentStatusHistoryResponseDto] })
  statusHistory!: ShipmentStatusHistoryResponseDto[];

  @ApiPropertyOptional()
  estimatedDelivery?: string;

  @ApiPropertyOptional()
  actualDelivery?: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

/** Privacy-preserving view returned before a transporter claims delivery. */
export class AvailableDeliveryResponseDto {
  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  pickupCity!: string;

  @ApiProperty()
  pickupProvince!: string;

  @ApiProperty()
  deliveryCity!: string;

  @ApiProperty()
  deliveryProvince!: string;

  @ApiProperty()
  itemCount!: number;

  @ApiProperty()
  createdAt!: string;
}
