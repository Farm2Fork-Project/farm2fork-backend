import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** A certification as buyers see it: never the uploaded document itself. */
export class FarmCertificationDto {
  @ApiProperty({ example: 'GlobalG.A.P.' })
  name!: string;

  @ApiPropertyOptional({ example: 'Pakistan Standards Authority' })
  issuedBy?: string;

  @ApiPropertyOptional({ example: '2025-03-01T00:00:00.000Z' })
  issuedDate?: string;

  @ApiPropertyOptional({ example: '2027-03-01T00:00:00.000Z' })
  expiryDate?: string;

  @ApiProperty({
    description: 'True when an expiry date is set and has passed.',
  })
  expired!: boolean;
}

export class FarmStatsDto {
  @ApiProperty({
    example: 4,
    description: 'Listings currently active with stock left.',
  })
  activeListings!: number;

  @ApiProperty({
    example: 12,
    description: 'Orders this farm has delivered through the platform.',
  })
  completedOrders!: number;
}

/**
 * Public face of a farm, shown on product pages. Deliberately excludes CNIC,
 * phone, email, bank details, street address and the precise map pin.
 */
export class FarmProfileResponseDto {
  @ApiProperty({ example: '6a2fe77bb77795516febc111' })
  farmerId!: string;

  @ApiProperty({ example: 'Green Valley Farm' })
  farmName!: string;

  @ApiPropertyOptional({
    example: 'Ahmed Raza',
    description: "The farmer's name.",
  })
  ownerName?: string;

  @ApiPropertyOptional({ description: 'Profile photo, 256px.' })
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'Multan' })
  city?: string;

  @ApiPropertyOptional({ example: 'Punjab' })
  province?: string;

  @ApiProperty({ type: [String], example: ['wheat', 'mango'] })
  cropTypes!: string[];

  @ApiPropertyOptional({ example: 12.5 })
  landSizeAcres?: number;

  @ApiProperty({ type: [FarmCertificationDto] })
  certifications!: FarmCertificationDto[];

  @ApiProperty({ example: '2026-06-15T11:52:27.282Z' })
  memberSince!: string;

  @ApiProperty({ type: FarmStatsDto })
  stats!: FarmStatsDto;
}
