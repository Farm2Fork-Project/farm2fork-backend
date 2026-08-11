import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import {
  AvailableDeliveryResponseDto,
  ClaimShipmentDto,
  ShipmentResponseDto,
  UpdateShipmentStatusDto,
} from './dto';
import { TransportService } from './transport.service';

@ApiTags('Shipments')
@ApiBearerAuth('JWT-auth')
@Controller('shipments')
export class TransportController {
  constructor(private readonly transportService: TransportService) {}

  @Get('available')
  @Roles(UserRole.Transporter)
  @ApiOperation({
    summary: 'List paid orders available for transporter self-claim',
    description:
      'The response deliberately omits street addresses and buyer contact details.',
  })
  @ApiOkResponse({ type: [AvailableDeliveryResponseDto] })
  @ApiErrorResponses(401, 403)
  findAvailable(): Promise<AvailableDeliveryResponseDto[]> {
    return this.transportService.findAvailable();
  }

  @Post('claims')
  @Roles(UserRole.Transporter)
  @ApiOperation({ summary: 'Atomically claim an available delivery' })
  @ApiCreatedResponse({ type: ShipmentResponseDto })
  @ApiErrorResponses(400, 401, 403, 409)
  claim(
    @CurrentUser() user: RequestUser,
    @Body() dto: ClaimShipmentDto,
  ): Promise<ShipmentResponseDto> {
    return this.transportService.claim(dto.orderId, user.id);
  }

  @Get()
  @Roles(UserRole.Buyer, UserRole.Farmer, UserRole.Transporter, UserRole.Admin)
  @ApiOperation({ summary: 'List shipments scoped to the authenticated user' })
  @ApiOkResponse({ type: [ShipmentResponseDto] })
  @ApiErrorResponses(401, 403)
  findAll(@CurrentUser() user: RequestUser): Promise<ShipmentResponseDto[]> {
    return this.transportService.findAll(user);
  }

  @Get(':id')
  @Roles(UserRole.Buyer, UserRole.Farmer, UserRole.Transporter, UserRole.Admin)
  @ApiOperation({ summary: 'Get one scoped shipment timeline' })
  @ApiParam({ name: 'id', description: 'Shipment id' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  @ApiErrorResponses(401, 403, 404)
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<ShipmentResponseDto> {
    return this.transportService.findOne(id, user);
  }

  @Patch(':id/status')
  @Roles(UserRole.Transporter)
  @ApiOperation({ summary: 'Advance the assigned transporter delivery status' })
  @ApiParam({ name: 'id', description: 'Shipment id' })
  @ApiOkResponse({ type: ShipmentResponseDto })
  @ApiErrorResponses(400, 401, 403, 404)
  updateStatus(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateShipmentStatusDto,
  ): Promise<ShipmentResponseDto> {
    return this.transportService.updateStatus(id, user.id, dto);
  }
}
