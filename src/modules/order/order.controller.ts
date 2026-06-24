import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { OrderService } from './order.service';
import {
  CreateOrderDto,
  OrderListResponseDto,
  OrderResponseDto,
  QueryOrderDto,
} from './dto';

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @Roles(UserRole.Buyer)
  @ApiOperation({
    summary: 'Place an order (US-06)',
    description:
      'Buyer only. All items must belong to one farmer (One-Order-One-Farmer §6.1); a mixed-farmer request is rejected with 400. The platform fee is snapshotted onto the order (§6.2).',
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    return this.orderService.create(user.id, dto);
  }

  @Get()
  @Roles(UserRole.Buyer, UserRole.Farmer, UserRole.Transporter, UserRole.Admin)
  @ApiOperation({
    summary: 'List orders',
    description:
      'Buyer/farmer/transporter see only their own orders; admin sees all and may filter by buyerId/farmerId.',
  })
  @ApiOkResponse({ type: OrderListResponseDto })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryOrderDto,
  ): Promise<OrderListResponseDto> {
    return this.orderService.findAll(user, query);
  }

  @Get(':id')
  @Roles(UserRole.Buyer, UserRole.Farmer, UserRole.Transporter, UserRole.Admin)
  @ApiOperation({
    summary: 'Get a single order',
    description: 'The caller must own the order, or be an admin.',
  })
  @ApiParam({ name: 'id', description: 'Order id' })
  @ApiOkResponse({ type: OrderResponseDto })
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.findOne(id, user);
  }

  @Patch(':id/cancel')
  @Roles(UserRole.Buyer)
  @ApiOperation({
    summary: 'Cancel an order',
    description:
      'Buyer only, and only before the order is delivered (status flow §17.3).',
  })
  @ApiParam({ name: 'id', description: 'Order id' })
  @ApiOkResponse({ type: OrderResponseDto })
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    return this.orderService.cancel(id, user);
  }
}
