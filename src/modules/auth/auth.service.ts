import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Model } from 'mongoose';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  AuthResultDto,
  AuthUserDto,
  ConfirmPasswordResetDto,
  LoginDto,
  RegisterBuyerDto,
  RegisterFarmerDto,
  RegisterTransporterDto,
} from './dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import {
  BuyerProfile,
  BuyerProfileDocument,
} from './schemas/buyer-profile.schema';
import {
  FarmerProfile,
  FarmerProfileDocument,
} from './schemas/farmer-profile.schema';
import {
  TransporterProfile,
  TransporterProfileDocument,
} from './schemas/transporter-profile.schema';
import { User, UserDocument } from './schemas/user.schema';

const BCRYPT_ROUNDS = 10;
const VERIFY_TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24h
const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1h
const VERIFY_KEY_PREFIX = 'auth:verify:';
const RESET_KEY_PREFIX = 'auth:pwreset:';

interface MongoDuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, unknown>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
    @InjectModel(BuyerProfile.name)
    private readonly buyerProfileModel: Model<BuyerProfileDocument>,
    @InjectModel(TransporterProfile.name)
    private readonly transporterProfileModel: Model<TransporterProfileDocument>,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  // ---------------------------------------------------------------------------
  // Registration (US-01)
  // ---------------------------------------------------------------------------

  async registerFarmer(dto: RegisterFarmerDto): Promise<AuthResultDto> {
    await this.assertEmailAvailable(dto.email);
    if (await this.farmerProfileModel.exists({ cnic: dto.cnic })) {
      throw new ConflictException('CNIC is already registered');
    }

    const user = await this.createUser(dto, UserRole.Farmer);
    await this.createProfileOrRollback(user, () =>
      this.farmerProfileModel.create({
        userId: user._id,
        farmName: dto.farmName,
        cnic: dto.cnic,
        farmLocation: dto.farmLocation,
        cropTypes: dto.cropTypes ?? [],
        landSizeAcres: dto.landSizeAcres,
        bankAccountDetails: dto.bankAccountDetails,
      }),
    );

    await this.issueEmailVerification(user);
    return this.buildAuthResult(user);
  }

  async registerBuyer(dto: RegisterBuyerDto): Promise<AuthResultDto> {
    await this.assertEmailAvailable(dto.email);
    if (await this.buyerProfileModel.exists({ cnic: dto.cnic })) {
      throw new ConflictException('CNIC is already registered');
    }

    const user = await this.createUser(dto, UserRole.Buyer);
    await this.createProfileOrRollback(user, () =>
      this.buyerProfileModel.create({
        userId: user._id,
        businessName: dto.businessName,
        businessType: dto.businessType,
        cnic: dto.cnic,
        addresses: dto.addresses ?? [],
      }),
    );

    await this.issueEmailVerification(user);
    return this.buildAuthResult(user);
  }

  async registerTransporter(
    dto: RegisterTransporterDto,
  ): Promise<AuthResultDto> {
    await this.assertEmailAvailable(dto.email);
    if (await this.transporterProfileModel.exists({ cnic: dto.cnic })) {
      throw new ConflictException('CNIC is already registered');
    }

    const user = await this.createUser(dto, UserRole.Transporter);
    await this.createProfileOrRollback(user, () =>
      this.transporterProfileModel.create({
        userId: user._id,
        vehicleType: dto.vehicleType,
        vehicleNumber: dto.vehicleNumber,
        licenseNumber: dto.licenseNumber,
        cnic: dto.cnic,
        serviceAreas: dto.serviceAreas ?? [],
      }),
    );

    await this.issueEmailVerification(user);
    return this.buildAuthResult(user);
  }

  // ---------------------------------------------------------------------------
  // Login (US-02)
  // ---------------------------------------------------------------------------

  async login(dto: LoginDto): Promise<AuthResultDto> {
    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase().trim() })
      .select('+passwordHash')
      .exec();

    // Generic message - never reveal whether the email exists.
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account has been deactivated');
    }

    return this.buildAuthResult(user);
  }

  /** Current authenticated user (GET /auth/me). */
  async getCurrentUser(userId: string): Promise<AuthUserDto> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return this.toAuthUser(user);
  }

  // ---------------------------------------------------------------------------
  // Email verification
  // ---------------------------------------------------------------------------

  async verifyEmail(token: string): Promise<{ verified: boolean }> {
    const key = `${VERIFY_KEY_PREFIX}${token}`;
    const userId = await this.redisService.get(key);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    await this.userModel
      .updateOne({ _id: userId }, { $set: { isVerified: true } })
      .exec();
    await this.redisService.del(key);
    return { verified: true };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .exec();
    if (user && !user.isVerified) {
      await this.issueEmailVerification(user);
    }
    // Generic response regardless of account state.
    return { message: 'If the account exists, a verification email was sent' };
  }

  // ---------------------------------------------------------------------------
  // Password reset (US-03)
  // ---------------------------------------------------------------------------

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const user = await this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .exec();

    if (user) {
      const token = this.generateToken();
      await this.redisService.set(
        `${RESET_KEY_PREFIX}${token}`,
        user._id.toString(),
        RESET_TOKEN_TTL_SECONDS,
      );
      this.sendEmailStub(
        user.email,
        'Farm2Fork password reset',
        `Use this token to reset your password: ${token}`,
      );
    }

    // Always generic - do not leak which emails are registered.
    return { message: 'If the account exists, a reset email was sent' };
  }

  async confirmPasswordReset(
    dto: ConfirmPasswordResetDto,
  ): Promise<{ message: string }> {
    const key = `${RESET_KEY_PREFIX}${dto.token}`;
    const userId = await this.redisService.get(key);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.userModel
      .updateOne({ _id: userId }, { $set: { passwordHash } })
      .exec();
    await this.redisService.del(key);
    return { message: 'Password has been reset' };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertEmailAvailable(email: string): Promise<void> {
    const exists = await this.userModel
      .exists({ email: email.toLowerCase().trim() })
      .exec();
    if (exists) {
      throw new ConflictException('Email is already registered');
    }
  }

  private async createUser(
    creds: { email: string; password: string; phone?: string },
    role: UserRole,
  ): Promise<UserDocument> {
    const passwordHash = await bcrypt.hash(creds.password, BCRYPT_ROUNDS);
    try {
      return await this.userModel.create({
        email: creds.email.toLowerCase().trim(),
        passwordHash,
        role,
        phone: creds.phone,
      });
    } catch (error) {
      throw this.mapDuplicateKeyError(error);
    }
  }

  private async createProfileOrRollback(
    user: UserDocument,
    createProfile: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await createProfile();
    } catch (error) {
      // Compensating action: the user is useless without its profile.
      await this.userModel.deleteOne({ _id: user._id }).exec();
      throw this.mapDuplicateKeyError(error);
    }
  }

  private async issueEmailVerification(user: UserDocument): Promise<void> {
    const token = this.generateToken();
    await this.redisService.set(
      `${VERIFY_KEY_PREFIX}${token}`,
      user._id.toString(),
      VERIFY_TOKEN_TTL_SECONDS,
    );
    this.sendEmailStub(
      user.email,
      'Verify your Farm2Fork account',
      `Use this token to verify your email: ${token}`,
    );
  }

  private buildAuthResult(user: UserDocument): AuthResultDto {
    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: this.jwtService.sign(payload),
      user: this.toAuthUser(user),
    };
  }

  private toAuthUser(user: UserDocument): AuthUserDto {
    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      phone: user.phone,
      isVerified: user.isVerified,
      isActive: user.isActive,
    };
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Stub email delivery (agreed approach). Logs to the console instead of
   * sending. A real provider is wired in a later sprint. The token is printed
   * here only because this IS the dev delivery channel.
   */
  private sendEmailStub(to: string, subject: string, body: string): void {
    this.logger.log(`[EMAIL STUB] To: ${to} | ${subject}\n${body}`);
  }

  private mapDuplicateKeyError(error: unknown): unknown {
    const dup = error as MongoDuplicateKeyError;
    if (dup?.code === 11000) {
      const field = Object.keys(dup.keyPattern ?? {})[0] ?? 'field';
      if (field === 'email') {
        return new ConflictException('Email is already registered');
      }
      if (field === 'cnic') {
        return new ConflictException('CNIC is already registered');
      }
      return new ConflictException(`${field} already exists`);
    }
    return error;
  }
}
