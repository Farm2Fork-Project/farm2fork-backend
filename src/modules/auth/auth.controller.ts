import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
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
  FirebaseAuthDto,
  FirebaseOnboardBuyerDto,
  FirebaseOnboardFarmerDto,
  FirebaseOnboardFinancialPartnerDto,
  FirebaseOnboardTransporterDto,
} from './dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

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

  @Public()
  @Post('firebase/onboard/financial-partner')
  @ApiOperation({
    summary:
      'Onboard an allowlisted financial partner for a verified Firebase identity',
  })
  @ApiResponse({ status: 201, type: AuthResultDto })
  @ApiErrorResponses(400, 401, 403, 409)
  onboardFinancialPartnerWithFirebase(
    @Body() dto: FirebaseOnboardFinancialPartnerDto,
  ): Promise<AuthResultDto> {
    return this.authService.onboardFinancialPartnerWithFirebase(dto);
  }

  @Public()
  @Post('web/session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create an HTTP-only Firebase web session for a verified identity',
    description:
      'Sets the Firebase Admin session cookie and returns only the sanitised Farm2Fork user. No backend JWT is returned to browser JavaScript.',
  })
  @ApiResponse({ status: 200, type: AuthUserDto })
  @ApiErrorResponses(400, 401, 403, 409)
  async createWebSession(
    @Body() dto: FirebaseAuthDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUserDto> {
    const result = await this.authService.createWebSession(dto.idToken);
    this.setWebSessionCookie(response, result.sessionCookie);
    return result.user;
  }

  @Public()
  @Post('web/onboard/farmer')
  @ApiOperation({
    summary: 'Onboard a verified Firebase farmer and create a web session',
  })
  @ApiResponse({ status: 201, type: AuthUserDto })
  @ApiErrorResponses(400, 401, 403, 409)
  async onboardFarmerForWeb(
    @Body() dto: FirebaseOnboardFarmerDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUserDto> {
    const result = await this.authService.onboardFarmerForWeb(dto);
    this.setWebSessionCookie(response, result.sessionCookie);
    return result.user;
  }

  @Public()
  @Post('web/onboard/buyer')
  @ApiOperation({
    summary: 'Onboard a verified Firebase buyer and create a web session',
  })
  @ApiResponse({ status: 201, type: AuthUserDto })
  @ApiErrorResponses(400, 401, 403, 409)
  async onboardBuyerForWeb(
    @Body() dto: FirebaseOnboardBuyerDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUserDto> {
    const result = await this.authService.onboardBuyerForWeb(dto);
    this.setWebSessionCookie(response, result.sessionCookie);
    return result.user;
  }

  @Public()
  @Post('web/onboard/transporter')
  @ApiOperation({
    summary: 'Onboard a verified Firebase transporter and create a web session',
  })
  @ApiResponse({ status: 201, type: AuthUserDto })
  @ApiErrorResponses(400, 401, 403, 409)
  async onboardTransporterForWeb(
    @Body() dto: FirebaseOnboardTransporterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUserDto> {
    const result = await this.authService.onboardTransporterForWeb(dto);
    this.setWebSessionCookie(response, result.sessionCookie);
    return result.user;
  }

  @Public()
  @Post('web/onboard/financial-partner')
  @ApiOperation({
    summary:
      'Onboard an allowlisted financial partner and create a web session',
  })
  @ApiResponse({ status: 201, type: AuthUserDto })
  @ApiErrorResponses(400, 401, 403, 409)
  async onboardFinancialPartnerForWeb(
    @Body() dto: FirebaseOnboardFinancialPartnerDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUserDto> {
    const result = await this.authService.onboardFinancialPartnerForWeb(dto);
    this.setWebSessionCookie(response, result.sessionCookie);
    return result.user;
  }

  @Public()
  @Post('web/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear the HTTP-only Firebase web session cookie' })
  @ApiResponse({ status: 200, schema: { example: { loggedOut: true } } })
  @ApiErrorResponses(403)
  logoutWebSession(@Res({ passthrough: true }) response: Response): {
    loggedOut: true;
  } {
    const secure = this.configService.get<boolean>(
      'WEB_SESSION_COOKIE_SECURE',
      true,
    );
    response.clearCookie(this.webSessionCookieName(), {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
    });
    return { loggedOut: true };
  }

  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @ApiResponse({ status: 200, type: AuthUserDto })
  @ApiErrorResponses(401)
  me(@CurrentUser() user: RequestUser): Promise<AuthUserDto> {
    return this.authService.getCurrentUser(user.id);
  }

  private setWebSessionCookie(response: Response, value: string): void {
    const secure = this.configService.get<boolean>(
      'WEB_SESSION_COOKIE_SECURE',
      true,
    );
    const ttlSeconds = this.configService.get<number>(
      'WEB_SESSION_TTL_SECONDS',
      86_400,
    );
    response.cookie(this.webSessionCookieName(), value, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: ttlSeconds * 1_000,
    });
  }

  private webSessionCookieName(): string {
    return this.configService.get<string>(
      'WEB_SESSION_COOKIE_NAME',
      'f2f_session',
    );
  }
}
