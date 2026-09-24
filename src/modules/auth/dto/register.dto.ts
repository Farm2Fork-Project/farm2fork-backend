import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  Max,
  MaxLength,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { PAKISTAN_BOUNDS } from '../../../common/geo/geo';

/** Pakistani CNIC: 13 digits, optionally formatted as 00000-0000000-0. */
export const CNIC_REGEX = /^\d{5}-?\d{7}-?\d$/;

/** Provinces and territories a farm can be in (pickup routing). */
export const PAKISTAN_PROVINCES = [
  'Punjab',
  'Sindh',
  'Khyber Pakhtunkhwa',
  'Balochistan',
  'Gilgit-Baltistan',
  'Azad Jammu and Kashmir',
  'Islamabad Capital Territory',
] as const;

/**
 * A farm's pickup location. Street/village, city, province and the map pin
 * are all required: buyers can only check out (the delivery fee is priced
 * from the pin) and transporters can only be matched when the farm has one.
 */
export class FarmLocationDto {
  @ApiProperty({ example: 'Chak 5, Canal Road' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  address!: string;

  @ApiProperty({ example: 'Multan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city!: string;

  @ApiProperty({ enum: PAKISTAN_PROVINCES, example: 'Punjab' })
  @IsIn(PAKISTAN_PROVINCES)
  province!: (typeof PAKISTAN_PROVINCES)[number];

  @ApiProperty({
    example: 30.1575,
    description: 'Farm pin latitude (inside Pakistan)',
  })
  @IsLatitude()
  @Min(PAKISTAN_BOUNDS.minLat, { message: 'Farm pin must be inside Pakistan' })
  @Max(PAKISTAN_BOUNDS.maxLat, { message: 'Farm pin must be inside Pakistan' })
  lat!: number;

  @ApiProperty({
    example: 71.5249,
    description: 'Farm pin longitude (inside Pakistan)',
  })
  @IsLongitude()
  @Min(PAKISTAN_BOUNDS.minLng, { message: 'Farm pin must be inside Pakistan' })
  @Max(PAKISTAN_BOUNDS.maxLng, { message: 'Farm pin must be inside Pakistan' })
  lng!: number;
}

export class GeoPointDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lng?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  province?: string;
}

export class BankAccountDetailsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountTitle?: string;
}

export class BuyerAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  street?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zip?: string;
}
