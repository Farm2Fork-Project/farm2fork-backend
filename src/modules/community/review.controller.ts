import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { ReportContentDto } from './dto/community.dto';
import {
  CreateReviewDto,
  QueryReviewsDto,
  ReviewPageDto,
  ReviewReplyDto,
  ReviewResponseDto,
} from './dto/review.dto';
import { ReviewService } from './review.service';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Post()
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.Buyer)
  @ApiOperation({ summary: 'Rate the farmer after a delivered order' })
  @ApiCreatedResponse({ type: ReviewResponseDto })
  @ApiErrorResponses(400, 401, 403, 404, 409)
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    return this.reviews.create(user, dto);
  }

  @Get('mine')
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.Buyer)
  @ApiOperation({ summary: 'Reviews you have written' })
  @ApiOkResponse({ type: [ReviewResponseDto] })
  @ApiErrorResponses(401, 403)
  mine(@CurrentUser() user: RequestUser): Promise<ReviewResponseDto[]> {
    return this.reviews.mine(user);
  }

  @Get('farmers/:farmerId')
  @Public()
  @ApiOperation({
    summary: 'Buyer reviews of a farmer with the rating summary (public)',
  })
  @ApiOkResponse({ type: ReviewPageDto })
  @ApiErrorResponses(400, 404)
  forFarmer(
    @Param('farmerId') farmerId: string,
    @Query() query: QueryReviewsDto,
  ): Promise<ReviewPageDto> {
    return this.reviews.forFarmer(farmerId, query);
  }

  @Post(':id/reply')
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.Farmer)
  @ApiOperation({ summary: 'Reply once to a review of your farm' })
  @ApiCreatedResponse({ type: ReviewResponseDto })
  @ApiErrorResponses(400, 401, 403, 404, 409)
  reply(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReviewReplyDto,
  ): Promise<ReviewResponseDto> {
    return this.reviews.reply(id, user, dto);
  }

  @Post(':id/report')
  @HttpCode(204)
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.Farmer, UserRole.Buyer, UserRole.Transporter)
  @ApiOperation({ summary: 'Report a review to the admin team' })
  @ApiNoContentResponse()
  @ApiErrorResponses(400, 401, 403, 404, 409)
  async report(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReportContentDto,
  ): Promise<void> {
    await this.reviews.report(id, user, dto);
  }
}
