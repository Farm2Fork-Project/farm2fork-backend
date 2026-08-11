import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import type { RequestUser } from '../../common/guards/roles.guard';
import { PaymentGateway } from './schemas/payment.schema';
import { PaymentService } from './payment.service';
import {
  CreatePaymentDto,
  InitiatePaymentResponseDto,
  PaymentListResponseDto,
  PaymentResponseDto,
  SimulatePaymentDto,
  PaymentWebhookDto,
  QueryPaymentDto,
} from './dto';

@ApiTags('Payments')
@ApiBearerAuth('JWT-auth')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @Roles(UserRole.Buyer)
  @ApiOperation({
    summary: 'Initiate payment for an order (US-07)',
    description:
      'Buyer only. Creates or resumes one persisted payment for an owned pending order.',
  })
  @ApiCreatedResponse({ type: InitiatePaymentResponseDto })
  initiate(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<InitiatePaymentResponseDto> {
    return this.paymentService.initiate(user.id, dto);
  }

  @Get()
  @Roles(UserRole.Buyer, UserRole.Admin)
  @ApiOperation({
    summary: 'List payments',
    description: 'Buyer sees only their own payments; admin sees all.',
  })
  @ApiOkResponse({ type: PaymentListResponseDto })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryPaymentDto,
  ): Promise<PaymentListResponseDto> {
    return this.paymentService.findAll(user, query);
  }

  @Get(':id')
  @Roles(UserRole.Buyer, UserRole.Admin)
  @ApiOperation({
    summary: 'Get payment status',
    description: 'The caller must own the payment, or be an admin.',
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentResponseDto })
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<PaymentResponseDto> {
    return this.paymentService.findOne(id, user);
  }

  @Public()
  @Post('webhook/:gateway')
  @ApiOperation({
    summary: 'Gateway payment callback (public)',
    description:
      'Reserved for JazzCash/Stripe callbacks. It returns 501 until provider-specific signature verification is implemented.',
  })
  @ApiParam({ name: 'gateway', enum: PaymentGateway })
  @ApiOkResponse({
    schema: {
      example: { received: true, gateway: 'jazzcash', status: 'success' },
    },
  })
  webhook(
    @Param('gateway') gateway: PaymentGateway,
    @Body() dto: PaymentWebhookDto,
  ): { received: boolean; gateway: PaymentGateway; status: string } {
    return this.paymentService.handleWebhook(gateway, dto);
  }

  @Post(':id/simulate')
  @Roles(UserRole.Buyer)
  @ApiOperation({
    summary: 'Settle a simulated payment in local development',
    description:
      'Buyer only. Available only when PAYMENT_SIMULATOR_ENABLED=true outside production.',
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentResponseDto })
  simulate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentService.simulate(id, user.id, dto.status);
  }

  @Post(':id/refund')
  @Roles(UserRole.Admin)
  @ApiOperation({
    summary: 'Refund a payment',
    description: 'Admin only.',
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentResponseDto })
  refund(@Param('id') id: string): Promise<PaymentResponseDto> {
    return this.paymentService.refund(id);
  }
}
