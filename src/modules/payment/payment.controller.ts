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
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
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
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post()
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.Buyer)
  @ApiOperation({
    summary: 'Initiate payment for an order (US-07)',
    description:
      'Buyer only. Creates or resumes one persisted payment for an owned pending order.',
  })
  @ApiCreatedResponse({ type: InitiatePaymentResponseDto })
  @ApiErrorResponses(400, 401, 403, 404)
  initiate(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<InitiatePaymentResponseDto> {
    return this.paymentService.initiate(user.id, dto);
  }

  @Get()
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.Buyer, UserRole.Admin)
  @ApiOperation({
    summary: 'List payments',
    description: 'Buyer sees only their own payments; admin sees all.',
  })
  @ApiOkResponse({ type: PaymentListResponseDto })
  @ApiErrorResponses(400, 401, 403)
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryPaymentDto,
  ): Promise<PaymentListResponseDto> {
    return this.paymentService.findAll(user, query);
  }

  @Get(':id')
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.Buyer, UserRole.Admin)
  @ApiOperation({
    summary: 'Get payment status',
    description: 'The caller must own the payment, or be an admin.',
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrorResponses(401, 403, 404)
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
  @ApiErrorResponses(400, 501)
  webhook(
    @Param('gateway') gateway: PaymentGateway,
    @Body() dto: PaymentWebhookDto,
  ): { received: boolean; gateway: PaymentGateway; status: string } {
    return this.paymentService.handleWebhook(gateway, dto);
  }

  @Post(':id/simulate')
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.Buyer)
  @ApiOperation({
    summary: 'Settle a simulated payment in local development',
    description:
      'Buyer only. Available only when PAYMENT_SIMULATOR_ENABLED=true outside production.',
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrorResponses(400, 401, 403, 404)
  simulate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SimulatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentService.simulate(id, user.id, dto.status);
  }

  @Post(':id/refund')
  @ApiBearerAuth('JWT-auth')
  @Roles(UserRole.Admin)
  @ApiOperation({
    summary: 'Refund a payment',
    description: 'Admin only.',
  })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ type: PaymentResponseDto })
  @ApiErrorResponses(400, 401, 403, 404)
  refund(@Param('id') id: string): Promise<PaymentResponseDto> {
    return this.paymentService.refund(id);
  }
}
