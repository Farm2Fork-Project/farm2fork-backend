import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/guards/roles.guard';
import { AuthService } from './auth.service';
import {
  AuthResultDto,
  AuthUserDto,
  ConfirmPasswordResetDto,
  LoginDto,
  RegisterBuyerDto,
  RegisterFarmerDto,
  RegisterTransporterDto,
  RequestPasswordResetDto,
  ResendVerificationDto,
  VerifyEmailDto,
} from './dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register/farmer')
  @ApiOperation({ summary: 'Register a new farmer account (US-01)' })
  @ApiResponse({ status: 201, type: AuthResultDto })
  registerFarmer(@Body() dto: RegisterFarmerDto): Promise<AuthResultDto> {
    return this.authService.registerFarmer(dto);
  }

  @Public()
  @Post('register/buyer')
  @ApiOperation({ summary: 'Register a new buyer account (US-01)' })
  @ApiResponse({ status: 201, type: AuthResultDto })
  registerBuyer(@Body() dto: RegisterBuyerDto): Promise<AuthResultDto> {
    return this.authService.registerBuyer(dto);
  }

  @Public()
  @Post('register/transporter')
  @ApiOperation({ summary: 'Register a new transporter account (US-01)' })
  @ApiResponse({ status: 201, type: AuthResultDto })
  registerTransporter(
    @Body() dto: RegisterTransporterDto,
  ): Promise<AuthResultDto> {
    return this.authService.registerTransporter(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password (US-02)' })
  @ApiResponse({ status: 200, type: AuthResultDto })
  login(@Body() dto: LoginDto): Promise<AuthResultDto> {
    return this.authService.login(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email with a token' })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ verified: boolean }> {
    return this.authService.verifyEmail(dto.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the email verification token' })
  resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset token (US-03)' })
  requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<{ message: string }> {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using a reset token (US-03)' })
  confirmPasswordReset(
    @Body() dto: ConfirmPasswordResetDto,
  ): Promise<{ message: string }> {
    return this.authService.confirmPasswordReset(dto);
  }

  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiResponse({ status: 200, type: AuthUserDto })
  me(@CurrentUser() user: RequestUser): Promise<AuthUserDto> {
    return this.authService.getCurrentUser(user.id);
  }
}
