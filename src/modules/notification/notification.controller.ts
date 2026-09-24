import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import type { RequestUser } from '../../common/guards/roles.guard';
import {
  NotificationPageDto,
  NotificationResponseDto,
  QueryNotificationsDto,
  RegisterDeviceTokenDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Put('device-token')
  @HttpCode(204)
  @ApiOperation({
    summary: "Register this device's FCM token for push notifications",
  })
  @ApiNoContentResponse()
  @ApiErrorResponses(400, 401)
  async registerToken(
    @CurrentUser() user: RequestUser,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    await this.notifications.registerDeviceToken(user.id, dto.token);
  }

  @Delete('device-token')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Stop push notifications to this account (on sign-out)',
  })
  @ApiNoContentResponse()
  @ApiErrorResponses(401)
  async clearToken(@CurrentUser() user: RequestUser) {
    await this.notifications.clearDeviceToken(user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List my notifications, newest first' })
  @ApiOkResponse({ type: NotificationPageDto })
  @ApiErrorResponses(400, 401)
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryNotificationsDto,
  ) {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications (for badges)' })
  @ApiOkResponse({ type: UnreadCountDto })
  @ApiErrorResponses(401)
  async unreadCount(@CurrentUser() user: RequestUser): Promise<UnreadCountDto> {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  @Post('read-all')
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  @ApiNoContentResponse()
  @ApiErrorResponses(401)
  async readAll(@CurrentUser() user: RequestUser) {
    await this.notifications.markAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiErrorResponses(401, 404)
  markRead(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<NotificationResponseDto> {
    return this.notifications.markRead(user.id, id);
  }
}
