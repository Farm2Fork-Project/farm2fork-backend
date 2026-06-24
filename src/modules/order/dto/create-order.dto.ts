import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

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
