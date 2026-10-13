import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsLatitude,
  IsLongitude,
  IsNumber,
  Max,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PAKISTAN_BOUNDS } from '../../../common/geo/geo';

export class OrderAddressDto {
  @ApiProperty({ example: '12 Mall Road' })
  @IsString()
  @IsNotEmpty()
  street!: string;

  @ApiProperty({ example: 'Lahore' })
  @IsString()
  @IsNotEmpty()
  city!: string;

  @ApiProperty({ example: 'Punjab' })
  @IsString()
  @IsNotEmpty()
  province!: string;

  @ApiPropertyOptional({ example: '54000' })
  @IsOptional()
  @IsString()
  zip?: string;

  @ApiProperty({
    example: 31.5204,
    description: 'Drop-off pin latitude (inside Pakistan)',
  })
  @IsLatitude()
  @Min(PAKISTAN_BOUNDS.minLat, {
    message: 'Drop-off pin must be inside Pakistan',
  })
  @Max(PAKISTAN_BOUNDS.maxLat, {
    message: 'Drop-off pin must be inside Pakistan',
  })
  lat!: number;

  @ApiProperty({
    example: 74.3587,
    description: 'Drop-off pin longitude (inside Pakistan)',
  })
  @IsLongitude()
  @Min(PAKISTAN_BOUNDS.minLng, {
    message: 'Drop-off pin must be inside Pakistan',
  })
  @Max(PAKISTAN_BOUNDS.maxLng, {
    message: 'Drop-off pin must be inside Pakistan',
  })
  lng!: number;
}

export class CreateOrderItemDto {
  @ApiProperty({ example: '6a2fe77bb77795516febc287' })
  @IsMongoId()
  productId!: string;

  @ApiProperty({ example: 10, description: 'Quantity in the product unit' })
  @IsNumber()
  @Min(1)
  quantity!: number;
}

/**
 * One order belongs to exactly one farmer (One-Order-One-Farmer rule §6.1).
 * Every productId in `items` must resolve to the same farmer; the cart groups
 * by farmer and submits one CreateOrderDto per group. Mixed-farmer requests are
 * rejected with 400 by OrderService.
 */
export class CreateOrderDto {
  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiProperty({ type: OrderAddressDto })
  @ValidateNested()
  @Type(() => OrderAddressDto)
  shippingAddress!: OrderAddressDto;
}
