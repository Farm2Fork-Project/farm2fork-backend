import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
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
  TransporterStatusDto,
  UpdateAvailabilityDto,
  UpdateShipmentStatusDto,
} from './dto';
import { LatLngDto } from '../../common/geo/geo';
import { TransportService } from './transport.service';

@ApiTags('Shipments')
@ApiBearerAuth('JWT-auth')
@Controller('shipments')
export class TransportController {
  constructor(private readonly transportService: TransportService) {}

  @Get('transporter/status')
  @Roles(UserRole.Transporter)
  @ApiOperation({
    summary: 'My online state, location freshness and delivery in progress',
  })
  @ApiOkResponse({ type: TransporterStatusDto })
  @ApiErrorResponses(401, 403, 404)
  status(@CurrentUser() user: RequestUser): Promise<TransporterStatusDto> {
    return this.transportService.getTransporterStatus(user.id);
  }

  @Put('transporter/availability')
  @Roles(UserRole.Transporter)
  @ApiOperation({
    summary: 'Go online (with current location) or offline',
    description:
      'Only online transporters with a recent location are offered deliveries.',
  })
  @ApiOkResponse({ type: TransporterStatusDto })
  @ApiErrorResponses(400, 401, 403, 404)
  availability(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateAvailabilityDto,
  ): Promise<TransporterStatusDto> {
    return this.transportService.updateAvailability(user.id, dto);
  }

  @Put('transporter/location')
  @HttpCode(204)
  @Roles(UserRole.Transporter)
  @ApiOperation({
    summary: 'Report current location while the app is open and online',
  })
  @ApiNoContentResponse()
  @ApiErrorResponses(400, 401, 403, 404)
  async location(
    @CurrentUser() user: RequestUser,
    @Body() dto: LatLngDto,
  ): Promise<void> {
    await this.transportService.updateLocation(user.id, dto);
  }

  @Get('available')
  @Roles(UserRole.Transporter)
  @ApiOperation({
    summary: 'Delivery offers near me, nearest farm first',
    description:
      'Paid, unclaimed orders whose farm is within the dispatch radius of your recent location, each with its fixed delivery fee. Empty while offline or during a delivery. The drop-off is approximate (~1 km) and has no street address until you accept.',
  })
  @ApiOkResponse({ type: [AvailableDeliveryResponseDto] })
  @ApiErrorResponses(401, 403, 404)
  findAvailable(
    @CurrentUser() user: RequestUser,
  ): Promise<AvailableDeliveryResponseDto[]> {
    return this.transportService.findAvailable(user.id);
  }

  @Post('offers/:orderId/decline')
  @HttpCode(204)
  @Roles(UserRole.Transporter)
  @ApiOperation({ summary: 'Decline a delivery offer (hides it for you)' })
  @ApiParam({ name: 'orderId', description: 'Order id of the offer' })
  @ApiNoContentResponse()
  @ApiErrorResponses(401, 403, 404)
  async decline(
    @CurrentUser() user: RequestUser,
    @Param('orderId') orderId: string,
  ): Promise<void> {
    await this.transportService.decline(orderId, user.id);
  }

  @Post('claims')
  @Roles(UserRole.Transporter)
  @ApiOperation({
    summary: 'Accept a delivery offer',
    description:
      'The first transporter to accept gets the delivery; others receive 409. Requires being online, near the farm and without a delivery in progress.',
  })
  @ApiCreatedResponse({ type: ShipmentResponseDto })
  @ApiErrorResponses(400, 401, 403, 404, 409)
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
