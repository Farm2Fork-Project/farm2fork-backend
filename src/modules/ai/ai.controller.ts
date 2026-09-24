import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { AiRateLimit } from '../../common/rate-limit/rate-limits';
import { AiService, MAX_QUALITY_IMAGE_BYTES } from './ai.service';
import {
  AiStatusResponseDto,
  GRADABLE_CROPS,
  PriceSuggestionRequestDto,
  PriceSuggestionResponseDto,
  QualityCheckRequestDto,
  QualityCheckResponseDto,
} from './dto/ai.dto';

@ApiTags('AI')
@ApiBearerAuth('JWT-auth')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('status')
  @Roles(UserRole.Farmer)
  @ApiOperation({
    summary: 'Whether the AI service is up and if its quality model is trained',
    description:
      'Farmer only. Lets the app label grades as a preview while the model is untrained.',
  })
  @ApiOkResponse({ type: AiStatusResponseDto })
  @ApiErrorResponses(401, 403)
  status(): Promise<AiStatusResponseDto> {
    return this.aiService.status();
  }

  @Post('quality')
  @Roles(UserRole.Farmer)
  @AiRateLimit()
  @UseInterceptors(
    FileInterceptor('image', {
      // Hard cap before the body is buffered; the service re-checks type.
      limits: { fileSize: MAX_QUALITY_IMAGE_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image', 'crop'],
      properties: {
        image: { type: 'string', format: 'binary' },
        crop: { type: 'string', enum: [...GRADABLE_CROPS] },
      },
    },
  })
  @ApiOperation({
    summary: 'Grade a produce photo (US-09)',
    description:
      'Farmer only. Runs the crop-conditioned grading model and stores the prediction.',
  })
  @ApiCreatedResponse({ type: QualityCheckResponseDto })
  @ApiErrorResponses(400, 401, 403, 413, 429, 503)
  checkQuality(
    @CurrentUser() user: RequestUser,
    @Body() body: QualityCheckRequestDto,
    @UploadedFile()
    image?: {
      buffer: Buffer;
      mimetype: string;
      originalname: string;
      size: number;
    },
  ): Promise<QualityCheckResponseDto> {
    return this.aiService.checkQuality(user.id, body.crop, image);
  }

  @Post('price')
  @Roles(UserRole.Farmer)
  @AiRateLimit()
  @ApiOperation({
    summary: 'Suggest a fair price range for a listing (US-09)',
    description:
      'Farmer only. Rule-based estimate (master context 10.3) until a market-data model exists; stored in ai_predictions.',
  })
  @ApiCreatedResponse({ type: PriceSuggestionResponseDto })
  @ApiErrorResponses(400, 401, 403, 429, 503)
  suggestPrice(
    @CurrentUser() user: RequestUser,
    @Body() body: PriceSuggestionRequestDto,
  ): Promise<PriceSuggestionResponseDto> {
    return this.aiService.suggestPrice(user.id, body);
  }
}
