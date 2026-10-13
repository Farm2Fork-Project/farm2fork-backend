import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsValidPhoneNumber } from '../../../common/validators/phone.validator';
import { BusinessType } from '../schemas/buyer-profile.schema';
import { VehicleType } from '../schemas/transporter-profile.schema';
import { FarmLocationResponseDto } from '../farmer-profile.controller';
import { AuthUserDto } from './auth-response.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimAll = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map((item) =>
        typeof item === 'string' ? item.trim() : item,
      )
    : value;

/**
 * Profile edit. Every field is optional; send only what changed. The first two
 * are common to all roles, the rest are accepted only for the matching role
 * (anything else is a 400 naming the field). CNIC and email are identity data
 * and are not editable here; the farm's pickup location keeps its own endpoint
 * (PATCH /farmers/me/farm-location).
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ayesha Khan' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fullName?: string;

  @ApiPropertyOptional({ example: '+923001234567' })
  @IsOptional()
  @IsValidPhoneNumber()
  phone?: string;

  // Buyer ------------------------------------------------------------------

  @ApiPropertyOptional({ description: 'Buyer only.', example: 'Khan Traders' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessName?: string;

  @ApiPropertyOptional({ enum: BusinessType, description: 'Buyer only.' })
  @IsOptional()
  @IsEnum(BusinessType)
  businessType?: BusinessType;

  // Farmer -----------------------------------------------------------------

  @ApiPropertyOptional({
    description: 'Farmer only.',
    example: 'Green Valley Farm',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  farmName?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Farmer only. Up to 20 crops.',
    example: ['Wheat', 'Tomatoes'],
  })
  @IsOptional()
  @Transform(trimAll)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  cropTypes?: string[];

  @ApiPropertyOptional({ description: 'Farmer only.', example: 12.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  landSizeAcres?: number;

  // Transporter ------------------------------------------------------------

  @ApiPropertyOptional({ enum: VehicleType, description: 'Transporter only.' })
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @ApiPropertyOptional({
    description: 'Transporter only.',
    example: 'LEA-1234',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  vehicleNumber?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Transporter only. Up to 20 areas.',
  })
  @IsOptional()
  @Transform(trimAll)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  serviceAreas?: string[];
}

/** Role-specific profile fields; only those of the caller's own role are set. */
export class ProfileDetailsDto {
  @ApiProperty({
    enum: ['buyer', 'farmer', 'transporter', 'financial_partner', 'admin'],
  })
  kind!: string;

  @ApiPropertyOptional({
    description:
      'Identity number with all but the last 4 digits hidden. Read-only.',
    example: '*********4561',
  })
  cnicMasked?: string;

  @ApiPropertyOptional()
  businessName?: string;

  @ApiPropertyOptional({ enum: BusinessType })
  businessType?: BusinessType;

  @ApiPropertyOptional()
  farmName?: string;

  @ApiPropertyOptional({ type: [String] })
  cropTypes?: string[];

  @ApiPropertyOptional()
  landSizeAcres?: number;

  @ApiPropertyOptional({ type: FarmLocationResponseDto })
  farmLocation?: FarmLocationResponseDto;

  @ApiPropertyOptional({ enum: VehicleType })
  vehicleType?: VehicleType;

  @ApiPropertyOptional()
  vehicleNumber?: string;

  @ApiPropertyOptional({ type: [String] })
  serviceAreas?: string[];

  @ApiPropertyOptional()
  institutionName?: string;

  @ApiPropertyOptional()
  institutionType?: string;
}

export class ProfileResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({
    description:
      'Best name to show: the person name, else the business / farm / institution name, else the email name.',
  })
  displayName!: string;

  @ApiProperty({ type: ProfileDetailsDto })
  profile!: ProfileDetailsDto;
}
