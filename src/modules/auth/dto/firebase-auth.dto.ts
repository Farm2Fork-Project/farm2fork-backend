import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsValidPhoneNumber } from '../../../common/validators/phone.validator';
import { BusinessType } from '../schemas/buyer-profile.schema';
import { VehicleType } from '../schemas/transporter-profile.schema';
import { InstitutionType } from '../schemas/financial-partner-profile.schema';
import {
  BankAccountDetailsDto,
  BuyerAddressDto,
  CNIC_REGEX,
  GeoPointDto,
} from './register.dto';

/**
 * A Firebase ID token, obtained by the client from the Firebase SDK after a
 * Google or email/password sign-in. The backend verifies it before doing
 * anything else.
 */
export class FirebaseAuthDto {
  @ApiProperty({
    description: 'Firebase ID token (JWT issued by Firebase Auth)',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}

/**
 * First-time onboarding. The email is taken from the verified Firebase token -
 * never from the body - so it cannot be spoofed. Only self-service roles
 * (farmer/buyer/transporter) may onboard through these endpoints; admin and
 * financial_partner are provisioned separately (allowlisted).
 */
class FirebaseOnboardDto extends FirebaseAuthDto {
  @ApiPropertyOptional({ example: '+923001234567' })
  @IsOptional()
  @IsValidPhoneNumber()
  phone?: string;
}

/** POST /auth/firebase/onboard/farmer */
export class FirebaseOnboardFarmerDto extends FirebaseOnboardDto {
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

/** POST /auth/firebase/onboard/buyer */
export class FirebaseOnboardBuyerDto extends FirebaseOnboardDto {
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

/** POST /auth/firebase/onboard/transporter */
export class FirebaseOnboardTransporterDto extends FirebaseOnboardDto {
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

/** POST /auth/firebase/onboard/financial-partner (allowlisted identities only). */
export class FirebaseOnboardFinancialPartnerDto extends FirebaseOnboardDto {
  @ApiProperty({ example: 'Farm2Fork Microfinance' })
  @IsString()
  @IsNotEmpty()
  institutionName!: string;

  @ApiProperty({ enum: InstitutionType, example: InstitutionType.Microfinance })
  @IsEnum(InstitutionType)
  institutionType!: InstitutionType;

  @ApiProperty({ example: 'LIC-12345' })
  @IsString()
  @IsNotEmpty()
  licenseNumber!: string;

  @ApiProperty({ example: '35202-1234567-1', description: 'Pakistani CNIC' })
  @Matches(CNIC_REGEX, { message: 'cnic must be a valid Pakistani CNIC' })
  cnic!: string;

  @ApiPropertyOptional({ example: 'Regional lending manager' })
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional({ example: 500000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  approvalLimit?: number;

  @ApiPropertyOptional({ type: [String], example: ['Lahore', 'Faisalabad'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceRegions?: string[];
}
