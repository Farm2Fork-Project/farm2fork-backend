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
import { ApiErrorResponses } from '../../common/decorators/api-error-responses.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/guards/roles.guard';
import { AuthService } from './auth.service';
import {
  AuthResultDto,
  AuthUserDto,
  ConfirmPasswordResetDto,
  FirebaseAuthDto,
  FirebaseOnboardBuyerDto,
  FirebaseOnboardFarmerDto,
  FirebaseOnboardTransporterDto,
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
  @ApiErrorResponses(400, 409)
  registerFarmer(@Body() dto: RegisterFarmerDto): Promise<AuthResultDto> {
    return this.authService.registerFarmer(dto);
  }

  @Public()
  @Post('register/buyer')
  @ApiOperation({ summary: 'Register a new buyer account (US-01)' })
  @ApiResponse({ status: 201, type: AuthResultDto })
  @ApiErrorResponses(400, 409)
  registerBuyer(@Body() dto: RegisterBuyerDto): Promise<AuthResultDto> {
    return this.authService.registerBuyer(dto);
  }

  @Public()
  @Post('register/transporter')
  @ApiOperation({ summary: 'Register a new transporter account (US-01)' })
  @ApiResponse({ status: 201, type: AuthResultDto })
  @ApiErrorResponses(400, 409)
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
  @ApiErrorResponses(400, 401)
  login(@Body() dto: LoginDto): Promise<AuthResultDto> {
    return this.authService.login(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email with a token' })
  @ApiResponse({ status: 200, schema: { example: { verified: true } } })
  @ApiErrorResponses(400, 401)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ verified: boolean }> {
    return this.authService.verifyEmail(dto.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the email verification token' })
  @ApiResponse({
    status: 200,
    schema: {
      example: { message: 'Verification email sent if the account exists' },
    },
  })
  @ApiErrorResponses(400)
  resendVerification(
    @Body() dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset token (US-03)' })
  @ApiResponse({
    status: 200,
    schema: {
      example: { message: 'Password reset email sent if the account exists' },
    },
  })
  @ApiErrorResponses(400)
  requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
  ): Promise<{ message: string }> {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using a reset token (US-03)' })
  @ApiResponse({
    status: 200,
    schema: { example: { message: 'Password reset complete' } },
  })
  @ApiErrorResponses(400, 401)
  confirmPasswordReset(
    @Body() dto: ConfirmPasswordResetDto,
  ): Promise<{ message: string }> {
    return this.authService.confirmPasswordReset(dto);
  }

  @Public()
  @Post('firebase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with a Firebase ID token (Google or email/password)',
    description:
      'Verifies the Firebase ID token and returns a Farm2Fork JWT. Returns 409 (code ONBOARDING_REQUIRED) when the identity has no account yet.',
  })
  @ApiResponse({ status: 200, type: AuthResultDto })
  @ApiErrorResponses(400, 401, 409)
  signInWithFirebase(@Body() dto: FirebaseAuthDto): Promise<AuthResultDto> {
    return this.authService.signInWithFirebase(dto.idToken);
  }

  @Public()
  @Post('firebase/onboard/farmer')
  @ApiOperation({
    summary: 'Onboard a farmer for a verified Firebase identity (US-01)',
  })
  @ApiResponse({ status: 201, type: AuthResultDto })
  @ApiErrorResponses(400, 401, 409)
  onboardFarmerWithFirebase(
    @Body() dto: FirebaseOnboardFarmerDto,
  ): Promise<AuthResultDto> {
    return this.authService.onboardFarmerWithFirebase(dto);
  }

  @Public()
  @Post('firebase/onboard/buyer')
  @ApiOperation({
    summary: 'Onboard a buyer for a verified Firebase identity (US-01)',
  })
  @ApiResponse({ status: 201, type: AuthResultDto })
  @ApiErrorResponses(400, 401, 409)
  onboardBuyerWithFirebase(
    @Body() dto: FirebaseOnboardBuyerDto,
  ): Promise<AuthResultDto> {
    return this.authService.onboardBuyerWithFirebase(dto);
  }

  @Public()
  @Post('firebase/onboard/transporter')
  @ApiOperation({
    summary: 'Onboard a transporter for a verified Firebase identity (US-01)',
  })
  @ApiResponse({ status: 201, type: AuthResultDto })
  @ApiErrorResponses(400, 401, 409)
  onboardTransporterWithFirebase(
    @Body() dto: FirebaseOnboardTransporterDto,
  ): Promise<AuthResultDto> {
    return this.authService.onboardTransporterWithFirebase(dto);
  }

  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiResponse({ status: 200, type: AuthUserDto })
  @ApiErrorResponses(401)
  me(@CurrentUser() user: RequestUser): Promise<AuthUserDto> {
    return this.authService.getCurrentUser(user.id);
  }
}
