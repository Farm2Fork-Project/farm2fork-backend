import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { AdminReasonDto } from './dto/admin.dto';
import { AdminContentService } from './admin-content.service';

export class ContentQueryDto {
  @IsOptional()
  @IsEnum({ unresolved: 'unresolved', resolved: 'resolved', active: 'active' })
  deliveryIssue?: 'unresolved' | 'resolved' | 'active';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsOptional()
  @IsEnum({ assigned: 'assigned', unassigned: 'unassigned' })
  assignment?: 'assigned' | 'unassigned';
  @IsOptional() @IsEnum({ visible: 'visible', hidden: 'hidden' }) visibility?:
    | 'visible'
    | 'hidden';
}
export class ContentVisibilityDto extends AdminReasonDto {
  @IsBoolean() hidden!: boolean;
}
@ApiTags('Admin content')
@ApiBearerAuth('JWT-auth')
@Roles(UserRole.Admin)
@Controller('admin')
export class AdminContentController {
  constructor(private readonly service: AdminContentService) {}
  @Get('products') products(@Query() query: ContentQueryDto) {
    return this.service.products(query);
  }
  @Get('products/:id') product(@Param('id') id: string) {
    return this.service.product(id);
  }
  @Patch('products/:id/visibility') productVisibility(
    @Param('id') id: string,
    @Body() dto: ContentVisibilityDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.visibility('product', id, dto, actor);
  }
  @Get('orders') orders(@Query() query: ContentQueryDto) {
    return this.service.orders(query);
  }
  @Get('orders/:id') order(@Param('id') id: string) {
    return this.service.order(id);
  }
  @Get('community/posts') posts(@Query() query: ContentQueryDto) {
    return this.service.posts(query);
  }
  @Get('community/posts/:id') post(@Param('id') id: string) {
    return this.service.post(id);
  }
  @Patch('community/posts/:id/visibility') postVisibility(
    @Param('id') id: string,
    @Body() dto: ContentVisibilityDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.visibility('post', id, dto, actor);
  }
  @Patch('community/comments/:id/visibility') commentVisibility(
    @Param('id') id: string,
    @Body() dto: ContentVisibilityDto,
    @CurrentUser() actor: RequestUser,
  ) {
    return this.service.visibility('comment', id, dto, actor);
  }
}
