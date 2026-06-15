import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/password.validator';
import { IsValidPhoneNumber } from '../../../common/validators/phone.validator';
import { BusinessType } from '../schemas/buyer-profile.schema';
import { VehicleType } from '../schemas/transporter-profile.schema';

/** Pakistani CNIC: 13 digits, optionally formatted as 00000-0000000-0. */
const CNIC_REGEX = /^\d{5}-?\d{7}-?\d$/;

export class AccountCredentialsDto {
  @ApiProperty({ example: 'farmer@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'StrongP@ss1',
    description:
      'Min 8 chars with uppercase, lowercase, number and special character',
  })
  @IsStrongPassword()
  password!: string;

  @ApiPropertyOptional({ example: '+923001234567' })
  @IsOptional()
  @IsValidPhoneNumber()
  phone?: string;
}

class GeoPointDto {
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

class BankAccountDetailsDto {
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

class BuyerAddressDto {
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

/** POST /auth/register/farmer */
export class RegisterFarmerDto extends AccountCredentialsDto {
  @ApiProperty({ example: 'Green Acres Farm' })
  @IsString()
  @IsNotEmpty()
  farmName!: string;

  @ApiProperty({ example: '35202-1234567-1', description: 'Pakistani CNIC' })
  @Matches(CNIC_REGEX, { message: 'cnic must be a valid Pakistani CNIC' })
  cnic!: string;

  @ApiPropertyOptional({ type: GeoPointDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeoPointDto)
  farmLocation?: GeoPointDto;

  @ApiPropertyOptional({ type: [String], example: ['wheat', 'tomatoes'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cropTypes?: string[];

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  landSizeAcres?: number;

  @ApiPropertyOptional({ type: BankAccountDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BankAccountDetailsDto)
  bankAccountDetails?: BankAccountDetailsDto;
}

/** POST /auth/register/buyer */
export class RegisterBuyerDto extends AccountCredentialsDto {
  @ApiProperty({ example: 'Fresh Mart' })
  @IsString()
  @IsNotEmpty()
  businessName!: string;

  @ApiProperty({ enum: BusinessType, example: BusinessType.Retailer })
  @IsEnum(BusinessType)
  businessType!: BusinessType;

  @ApiProperty({ example: '35202-1234567-1', description: 'Pakistani CNIC' })
  @Matches(CNIC_REGEX, { message: 'cnic must be a valid Pakistani CNIC' })
  cnic!: string;

  @ApiPropertyOptional({ type: [BuyerAddressDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuyerAddressDto)
  addresses?: BuyerAddressDto[];
}

/** POST /auth/register/transporter */
export class RegisterTransporterDto extends AccountCredentialsDto {
  @ApiProperty({ enum: VehicleType, example: VehicleType.Van })
  @IsEnum(VehicleType)
  vehicleType!: VehicleType;

  @ApiProperty({ example: 'LEB-1234' })
  @IsString()
  @IsNotEmpty()
  vehicleNumber!: string;

  @ApiProperty({ example: 'DL-998877' })
  @IsString()
  @IsNotEmpty()
  licenseNumber!: string;

  @ApiProperty({ example: '35202-1234567-1', description: 'Pakistani CNIC' })
  @Matches(CNIC_REGEX, { message: 'cnic must be a valid Pakistani CNIC' })
  cnic!: string;

  @ApiPropertyOptional({ type: [String], example: ['Lahore', 'Faisalabad'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceAreas?: string[];
}
