import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { MAX_DOCUMENT_BYTES } from '../../infrastructure/storage/file-kind';
import {
  CreateLoanApplicationDto,
  LoanApplicationResponseDto,
  LoanDecisionDto,
  LoanLimitsDto,
  LoanPageDto,
  MAX_LOAN_DOCUMENTS,
  QueryLoansDto,
} from './dto/loan.dto';
import { LoanService, UploadedDocument } from './loan.service';

@ApiTags('Loans')
@ApiBearerAuth('JWT-auth')
@Controller('loans')
export class LoanController {
  constructor(private readonly loans: LoanService) {}

  @Get('limits')
  @Roles(UserRole.Farmer, UserRole.FinancialPartner, UserRole.Admin)
  @ApiOperation({ summary: 'Allowed loan amount, duration and document count' })
  @ApiOkResponse({ type: LoanLimitsDto })
  @ApiErrorResponses(401, 403)
  limits(): Promise<LoanLimitsDto> {
    return this.loans.limits();
  }

  @Post()
  @Roles(UserRole.Farmer)
  @UseInterceptors(
    FilesInterceptor('documents', MAX_LOAN_DOCUMENTS, {
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: MAX_LOAN_DOCUMENTS },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['amount', 'purpose', 'durationMonths'],
      properties: {
        amount: { type: 'number' },
        purpose: { type: 'string' },
        durationMonths: { type: 'integer', minimum: 1, maximum: 36 },
        documents: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description:
            'CNIC / land papers: PDF, JPEG, PNG or WebP, up to 10 MB each',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Apply for a microfinance loan (US-10)',
    description:
      'Farmers only (master context 6.3). One open application at a time. Documents are stored privately.',
  })
  @ApiCreatedResponse({ type: LoanApplicationResponseDto })
  @ApiErrorResponses(400, 401, 403, 409, 413)
  apply(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateLoanApplicationDto,
    @UploadedFiles() files?: UploadedDocument[],
  ): Promise<LoanApplicationResponseDto> {
    return this.loans.apply(user, dto, files);
  }

  @Get('mine')
  @Roles(UserRole.Farmer)
  @ApiOperation({ summary: 'My loan applications, newest first' })
  @ApiOkResponse({ type: [LoanApplicationResponseDto] })
  @ApiErrorResponses(401, 403)
  mine(
    @CurrentUser() user: RequestUser,
  ): Promise<LoanApplicationResponseDto[]> {
    return this.loans.findMine(user.id);
  }

  @Get()
  @Roles(UserRole.FinancialPartner, UserRole.Admin)
  @ApiOperation({
    summary: 'Loan applications to review, with a farm summary per applicant',
  })
  @ApiOkResponse({ type: LoanPageDto })
  @ApiErrorResponses(400, 401, 403)
  findAll(@Query() query: QueryLoansDto): Promise<LoanPageDto> {
    return this.loans.findAll(query);
  }

  @Get(':id')
  @Roles(UserRole.Farmer, UserRole.FinancialPartner, UserRole.Admin)
  @ApiOperation({
    summary: 'One application with short-lived document links',
    description: 'The applicant, financial partners and admins only.',
  })
  @ApiOkResponse({ type: LoanApplicationResponseDto })
  @ApiErrorResponses(401, 403, 404)
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<LoanApplicationResponseDto> {
    return this.loans.findOne(id, user);
  }

  @Post(':id/review')
  @Roles(UserRole.FinancialPartner, UserRole.Admin)
  @ApiOperation({ summary: 'Take a pending application into review' })
  @ApiCreatedResponse({ type: LoanApplicationResponseDto })
  @ApiErrorResponses(401, 403, 404, 409)
  review(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<LoanApplicationResponseDto> {
    return this.loans.startReview(id, user);
  }

  @Post(':id/decision')
  @Roles(UserRole.FinancialPartner, UserRole.Admin)
  @ApiOperation({
    summary: 'Approve (creates the repayment schedule) or reject with a reason',
  })
  @ApiCreatedResponse({ type: LoanApplicationResponseDto })
  @ApiErrorResponses(400, 401, 403, 404, 409)
  decide(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: LoanDecisionDto,
    @Ip() ip: string,
  ): Promise<LoanApplicationResponseDto> {
    return this.loans.decide(id, user, dto, ip);
  }

  @Post(':id/instalments/:index/paid')
  @Roles(UserRole.FinancialPartner, UserRole.Admin)
  @ApiOperation({
    summary:
      'Record an instalment as repaid (the last one marks the loan repaid)',
  })
  @ApiCreatedResponse({ type: LoanApplicationResponseDto })
  @ApiErrorResponses(401, 403, 404, 409)
  markPaid(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ): Promise<LoanApplicationResponseDto> {
    return this.loans.markInstalmentPaid(id, index);
  }
}
