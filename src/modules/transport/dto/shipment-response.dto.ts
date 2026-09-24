import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LatLngDto } from '../../../common/geo/geo';
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

  @ApiPropertyOptional({ description: 'Map pin (absent on legacy shipments)' })
  lat?: number;

  @ApiPropertyOptional({ description: 'Map pin (absent on legacy shipments)' })
  lng?: number;
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

  @ApiPropertyOptional({
    description: 'Fixed delivery fee the transporter earns (PKR)',
  })
  deliveryFee?: number;

  @ApiPropertyOptional()
  estimatedDelivery?: string;

  @ApiPropertyOptional()
  actualDelivery?: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class OfferPointDto {
  @ApiProperty() lat!: number;
  @ApiProperty() lng!: number;
  @ApiProperty() city!: string;
  @ApiProperty() province!: string;
}

export class OfferItemDto {
  @ApiProperty() productName!: string;
  @ApiProperty() quantity!: number;
}

/**
 * A delivery offer shown before the transporter accepts. The pickup is the
 * farm's exact pin; the drop-off is the buyer's area rounded to ~1 km and
 * has no street address until the delivery is accepted.
 */
export class AvailableDeliveryResponseDto {
  @ApiProperty({ description: 'Fixed price the transporter earns (PKR)' })
  deliveryFee!: number;

  @ApiProperty({ description: 'Estimated road distance farm -> drop-off' })
  deliveryDistanceKm!: number;

  @ApiProperty({ description: 'Straight-line distance from you to the farm' })
  distanceToPickupKm!: number;

  @ApiProperty({ type: OfferPointDto })
  pickup!: OfferPointDto;

  @ApiPropertyOptional()
  farmName?: string;

  @ApiProperty({
    type: OfferPointDto,
    description: 'Approximate (~1 km) until accepted',
  })
  dropoffArea!: OfferPointDto;

  @ApiProperty({ type: [OfferItemDto] })
  items!: OfferItemDto[];

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

export class UpdateAvailabilityDto {
  @ApiProperty({ description: 'Go online (receive offers) or offline' })
  @IsBoolean()
  online!: boolean;

  @ApiPropertyOptional({
    type: LatLngDto,
    description: 'Required when going online',
  })
  @ValidateIf((dto: UpdateAvailabilityDto) => dto.online)
  @IsDefined({ message: 'Your location is required to go online' })
  @ValidateNested()
  @Type(() => LatLngDto)
  location?: LatLngDto;
}

export class TransporterStatusDto {
  @ApiProperty() online!: boolean;

  @ApiProperty({
    description: 'False when the last location is too old to match offers',
  })
  locationFresh!: boolean;

  @ApiPropertyOptional() lastLocationAt?: string;

  @ApiPropertyOptional({
    description: 'Set while you have a delivery in progress',
  })
  activeShipmentId?: string;

  @ApiProperty({ description: 'Offers come from farms within this distance' })
  radiusKm!: number;
}
