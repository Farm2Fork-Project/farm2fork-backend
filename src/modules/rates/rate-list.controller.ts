import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
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
  QueryRateListsDto,
  RateListDetailDto,
  RateListPageDto,
  RateListStatusDto,
  UploadRateListDto,
} from './rate-list.dto';
import { RateListService, UploadedRateFile } from './rate-list.service';

const MEMBERS = [
  UserRole.Farmer,
  UserRole.Buyer,
  UserRole.Transporter,
  UserRole.FinancialPartner,
  UserRole.Admin,
];

@ApiTags('Admin rate lists')
@ApiBearerAuth('JWT-auth')
@Roles(UserRole.Admin)
@Controller('admin/rate-lists')
export class AdminRateListController {
  constructor(private readonly rates: RateListService) {}

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'document', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 2 } },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'tradingDate', 'market', 'source', 'sourceUrl'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV with columns commodity, unit, min, max, fqp',
        },
        document: {
          type: 'string',
          format: 'binary',
          description: 'Optional scan of the official list (PDF or image)',
        },
        tradingDate: { type: 'string', example: '2026-11-14' },
        market: { type: 'string', example: 'Lahore' },
        source: { type: 'string', example: 'Market Committee Lahore' },
        sourceUrl: { type: 'string', example: 'http://www.amis.pk' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a dated official rate list. Saved as a draft to check.',
  })
  @ApiCreatedResponse({ type: RateListDetailDto })
  @ApiErrorResponses(400, 401, 403, 413)
  upload(
    @CurrentUser() actor: RequestUser,
    @Body() dto: UploadRateListDto,
    @UploadedFiles()
    files?: { file?: UploadedRateFile[]; document?: UploadedRateFile[] },
  ): Promise<RateListDetailDto> {
    return this.rates.upload(
      actor,
      dto,
      files?.file?.[0],
      files?.document?.[0],
    );
  }

  @Get()
  @ApiOperation({ summary: 'Every rate list, drafts and withdrawn included' })
  @ApiOkResponse({ type: RateListPageDto })
  list(@Query() query: QueryRateListsDto): Promise<RateListPageDto> {
    return this.rates.adminList(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: RateListDetailDto })
  @ApiErrorResponses(401, 403, 404)
  detail(@Param('id') id: string): Promise<RateListDetailDto> {
    return this.rates.adminDetail(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Publish a checked list, or withdraw a wrong one' })
  @ApiOkResponse({ type: RateListDetailDto })
  @ApiErrorResponses(400, 401, 403, 404, 409)
  setStatus(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() dto: RateListStatusDto,
  ): Promise<RateListDetailDto> {
    return this.rates.setStatus(id, dto.status, dto.reason, actor);
  }
}

@ApiTags('Market rates')
@ApiBearerAuth('JWT-auth')
@Roles(...MEMBERS)
@Controller('rates')
export class RateListController {
  constructor(private readonly rates: RateListService) {}

  @Get('latest')
  @ApiOperation({
    summary:
      'Newest published rate list, for the given market when it has one. Null when none is published.',
  })
  @ApiOkResponse({ type: RateListDetailDto })
  latest(@Query('market') market?: string): Promise<RateListDetailDto | null> {
    return this.rates.latest(
      typeof market === 'string' ? market.slice(0, 60) : undefined,
    );
  }

  @Get('markets')
  @ApiOperation({ summary: 'Markets that have a published rate list' })
  @ApiOkResponse({ type: [String] })
  markets(): Promise<string[]> {
    return this.rates.markets();
  }

  @Get()
  @ApiOperation({ summary: 'Published rate lists, newest trading day first' })
  @ApiOkResponse({ type: RateListPageDto })
  list(@Query() query: QueryRateListsDto): Promise<RateListPageDto> {
    return this.rates.published({ ...query, status: undefined });
  }

  @Get(':id')
  @ApiOkResponse({ type: RateListDetailDto })
  @ApiErrorResponses(401, 403, 404)
  detail(@Param('id') id: string): Promise<RateListDetailDto> {
    return this.rates.publishedDetail(id);
  }
}
