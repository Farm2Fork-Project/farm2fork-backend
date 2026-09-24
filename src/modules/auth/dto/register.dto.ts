import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  MaxLength,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

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
 * A farm's pickup location. Street/village, city and province are all
 * required: transporters only see (and can only claim) orders whose farm has
 * a complete location, so an incomplete one silently blocks delivery.
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lng?: number;
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
