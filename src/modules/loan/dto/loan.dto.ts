import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { LoanStatus } from '../schemas/loan-application.schema';

export const MAX_LOAN_DOCUMENTS = 4;

/** Multipart form fields; documents arrive as files. */
export class CreateLoanApplicationDto {
  @ApiProperty({ example: 150000, description: 'Requested amount in PKR' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(1)
  amount!: number;

  @ApiProperty({ example: 'Buy seeds and fertiliser for the wheat season' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  purpose!: string;

  @ApiProperty({ example: 6, minimum: 1, maximum: 36 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  durationMonths!: number;
}

export class QueryLoansDto {
  @ApiPropertyOptional({ enum: LoanStatus })
  @IsOptional()
  @IsIn(Object.values(LoanStatus))
  status?: LoanStatus;

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

export class LoanDecisionDto {
  @ApiProperty({ enum: [LoanStatus.Approved, LoanStatus.Rejected] })
  @IsIn([LoanStatus.Approved, LoanStatus.Rejected])
  decision!: LoanStatus.Approved | LoanStatus.Rejected;

  @ApiPropertyOptional({ description: 'Required when rejecting' })
  @ValidateIf(
    (dto: LoanDecisionDto) =>
      dto.decision === LoanStatus.Rejected || dto.note !== undefined,
  )
  @IsString()
  @IsNotEmpty({ message: 'Give the farmer a reason for the rejection' })
  @MaxLength(1000)
  note?: string;
}

export class RepaymentInstallmentDto {
  @ApiProperty() index!: number;
  @ApiProperty() dueDate!: string;
  @ApiProperty() amount!: number;
  @ApiProperty() isPaid!: boolean;
  @ApiPropertyOptional() paidAt?: string;
}

export class LoanApplicantDto {
  @ApiProperty() farmName!: string;
  @ApiPropertyOptional() city?: string;
  @ApiPropertyOptional() province?: string;
  @ApiPropertyOptional() landSizeAcres?: number;
  @ApiProperty({ type: [String] }) cropTypes!: string[];
  @ApiProperty({ description: 'Orders delivered through Farm2Fork' })
  deliveredOrders!: number;
  @ApiProperty({ description: 'Item revenue from delivered orders (PKR)' })
  deliveredRevenue!: number;
}

export class LoanDocumentDto {
  @ApiProperty() index!: number;
  @ApiProperty({
    description: 'Short-lived link (about 10 minutes). Do not store it.',
  })
  url!: string;
}

export class LoanApplicationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() applicantId!: string;
  @ApiProperty() amount!: number;
  @ApiProperty() purpose!: string;
  @ApiProperty() durationMonths!: number;
  @ApiProperty({ enum: LoanStatus }) status!: LoanStatus;
  @ApiPropertyOptional() reviewNote?: string;
  @ApiProperty() documentCount!: number;
  @ApiProperty({ type: [RepaymentInstallmentDto] })
  repaymentSchedule!: RepaymentInstallmentDto[];
  @ApiPropertyOptional({
    type: LoanApplicantDto,
    description: 'Financial partners and admins only',
  })
  applicant?: LoanApplicantDto;
  @ApiPropertyOptional({
    type: [LoanDocumentDto],
    description: 'Only on the single-application read',
  })
  documents?: LoanDocumentDto[];
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class LoanPageDto {
  @ApiProperty({ type: [LoanApplicationResponseDto] })
  data!: LoanApplicationResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

export class LoanLimitsDto {
  @ApiProperty() minAmount!: number;
  @ApiProperty() maxAmount!: number;
  @ApiProperty() maxDurationMonths!: number;
  @ApiProperty() maxDocuments!: number;
}
