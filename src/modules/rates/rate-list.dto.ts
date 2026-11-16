import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { RateListStatus } from './schemas/rate-list.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Multipart fields that accompany the CSV file. */
export class UploadRateListDto {
  @ApiProperty({
    example: '2026-11-14',
    description: 'Trading day of the prices',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Trading date must be YYYY-MM-DD',
  })
  tradingDate!: string;

  @ApiProperty({ example: 'Lahore' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  market!: string;

  @ApiProperty({ example: 'Market Committee Lahore' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  source!: string;

  @ApiProperty({ example: 'http://www.amis.pk' })
  @Transform(trim)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(300)
  sourceUrl!: string;
}

export class RateListStatusDto {
  @ApiProperty({ enum: [RateListStatus.Published, RateListStatus.Withdrawn] })
  @IsEnum({
    published: RateListStatus.Published,
    withdrawn: RateListStatus.Withdrawn,
  })
  status!: RateListStatus.Published | RateListStatus.Withdrawn;

  @ApiProperty({ example: 'Checked against the committee notice.' })
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class QueryRateListsDto {
  @ApiPropertyOptional({ enum: RateListStatus, description: 'Admin only' })
  @IsOptional()
  @IsEnum(RateListStatus)
  status?: RateListStatus;

  @ApiPropertyOptional({ example: 'Lahore' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  market?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class RateEntryDto {
  @ApiProperty() commodity!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() minPrice!: number;
  @ApiProperty() maxPrice!: number;
  @ApiPropertyOptional() fairPrice?: number;
}

export class RateListSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '2026-11-14' }) tradingDate!: string;
  @ApiProperty() market!: string;
  @ApiProperty() source!: string;
  @ApiProperty() sourceUrl!: string;
  @ApiProperty({ enum: RateListStatus }) status!: RateListStatus;
  @ApiProperty() entryCount!: number;
  @ApiPropertyOptional() fileName?: string;
  @ApiPropertyOptional() publishedAt?: string;
  @ApiProperty() createdAt!: string;
}

export class RateListDetailDto extends RateListSummaryDto {
  @ApiProperty({ type: [RateEntryDto] }) entries!: RateEntryDto[];
  @ApiPropertyOptional({
    description: 'Admin only: short-lived link to the scanned original',
  })
  documentUrl?: string;
}

export class RateListPageDto {
  @ApiProperty({ type: [RateListSummaryDto] }) data!: RateListSummaryDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
