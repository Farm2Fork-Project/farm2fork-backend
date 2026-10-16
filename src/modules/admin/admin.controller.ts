import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { AdminService } from './admin.service';
import {
  AdminQueryDto,
  SaveAdminConfigDto,
  SetUserStatusDto,
} from './dto/admin.dto';

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@Roles(UserRole.Admin)
@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}
  @Get('overview') overview() {
    return this.service.overview();
  }
  @Get('users') users(@Query() query: AdminQueryDto) {
    return this.service.users(query);
  }
  @Get('users/:id') user(@Param('id') id: string) {
    return this.service.user(id);
  }
  @Patch('users/:id/status') status(
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.setUserStatus(id, dto, actor);
  }
  @Get('audit-logs') audit(@Query() query: AdminQueryDto) {
    return this.service.audit(query);
  }
  @Get('config') config() {
    return this.service.config();
  }
  @Patch('config') save(
    @Body() dto: SaveAdminConfigDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.saveConfig(dto, actor);
  }
}
