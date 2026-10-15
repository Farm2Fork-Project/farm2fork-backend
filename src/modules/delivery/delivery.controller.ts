import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { DeliveryService } from './delivery.service';
import {
  CompleteDeliveryDto,
  DeliveryIssueDto,
  PayoutCorrectionDto,
  EarningsQueryDto,
  ManualTransferDto,
  ReassignDeliveryDto,
  RecordPayoutDto,
  ResolveDeliveryDto,
} from './delivery.dto';
@ApiTags('Delivery operations')
@ApiBearerAuth('JWT-auth')
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}
  @Get('shipments/:id/code') @Roles(UserRole.Buyer) code(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.code(id, user);
  }
  @Post('shipments/:id/code/reissue') @Roles(UserRole.Buyer) reissue(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.code(id, user, true);
  }
  @Post('shipments/:id/complete') @Roles(UserRole.Transporter) complete(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CompleteDeliveryDto,
  ) {
    return this.service.complete(id, user, dto);
  }
  @Post('shipments/:id/issue') @Roles(UserRole.Transporter) issue(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: DeliveryIssueDto,
  ) {
    return this.service.issue(id, user, dto);
  }
  @Get('earnings') @Roles(UserRole.Transporter) earnings(
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.earnings(user.id);
  }
  @Get('admin/earnings') @Roles(UserRole.Admin) adminEarnings(
    @Query() query: EarningsQueryDto,
  ) {
    return this.service.earnings(query.transporterId);
  }
  @Post('admin/payouts/:id/reverse') @Roles(UserRole.Admin) reverse(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: PayoutCorrectionDto,
  ) {
    return this.service.reversePayout(id, dto, user);
  }
  @Post('admin/payouts') @Roles(UserRole.Admin) payout(
    @CurrentUser() user: RequestUser,
    @Body() dto: RecordPayoutDto,
  ) {
    return this.service.payout(dto, user);
  }
  @Post('admin/shipments/:id/reassign') @Roles(UserRole.Admin) reassign(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ReassignDeliveryDto,
  ) {
    return this.service.reassign(id, dto, user);
  }
  @Post('admin/shipments/:id/resolve') @Roles(UserRole.Admin) resolve(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ResolveDeliveryDto,
  ) {
    return this.service.resolve(id, dto, user);
  }
  @Get('admin/orders/:id/refund') @Roles(UserRole.Admin) refundRecord(
    @Param('id') id: string,
  ) {
    return this.service.refundRecord(id);
  }
  @Post('admin/orders/:id/refund') @Roles(UserRole.Admin) refund(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ManualTransferDto,
  ) {
    return this.service.refund(id, dto, user);
  }
}
