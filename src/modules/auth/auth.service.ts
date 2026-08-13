import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { FirebaseAuthService } from '../../infrastructure/firebase/firebase-auth.service';
import { FirebaseIdentity } from '../../infrastructure/firebase/firebase-identity.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  AuthResultDto,
  AuthUserDto,
  FirebaseOnboardBuyerDto,
  FirebaseOnboardFarmerDto,
  FirebaseOnboardFinancialPartnerDto,
  FirebaseOnboardTransporterDto,
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
import {
  FinancialPartnerProfile,
  FinancialPartnerProfileDocument,
} from './schemas/financial-partner-profile.schema';
import { User, UserDocument } from './schemas/user.schema';

/**
 * Roles that may self-register (choose their own role at onboarding). admin and
 * financial_partner are privileged and provisioned separately via an allowlist,
 * never self-assignable through a public endpoint (master context 17.2).
 */
const SELF_SERVICE_ROLES: UserRole[] = [
  UserRole.Farmer,
  UserRole.Buyer,
  UserRole.Transporter,
];

const EMAIL_VERIFICATION_REQUIRED = {
  statusCode: 401,
  code: 'EMAIL_VERIFICATION_REQUIRED',
  message: 'Verify your Firebase email before continuing.',
} as const;

export interface WebSessionResult {
  user: AuthUserDto;
  sessionCookie: string;
}

interface MongoDuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, unknown>;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(FarmerProfile.name)
    private readonly farmerProfileModel: Model<FarmerProfileDocument>,
    @InjectModel(BuyerProfile.name)
    private readonly buyerProfileModel: Model<BuyerProfileDocument>,
    @InjectModel(TransporterProfile.name)
    private readonly transporterProfileModel: Model<TransporterProfileDocument>,
    @InjectModel(FinancialPartnerProfile.name)
    private readonly financialPartnerProfileModel: Model<FinancialPartnerProfileDocument>,
    private readonly jwtService: JwtService,
    private readonly firebaseAuthService: FirebaseAuthService,
    private readonly configService: ConfigService,
  ) {}

  /** Current authenticated user (GET /auth/me). */
  async getCurrentUser(userId: string): Promise<AuthUserDto> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return this.toAuthUser(user);
  }

  // ---------------------------------------------------------------------------
  // Firebase authentication (Google / email-password)
  //
  // Firebase authenticates; the backend authorizes. We verify the Firebase ID
  // token, then either sign in an existing account (minting our own JWT) or,
  // for a first-time identity, require onboarding to capture role + profile/KYC.
  // ---------------------------------------------------------------------------

  /** Sign in a returning user with a verified Firebase identity. */
  async signInWithFirebase(idToken: string): Promise<AuthResultDto> {
    return this.buildAuthResult(await this.resolveFirebaseSignIn(idToken));
  }

  /** Web-only transport: returns a session cookie, never a backend JWT. */
  async createWebSession(idToken: string): Promise<WebSessionResult> {
    const user = await this.resolveFirebaseSignIn(idToken);
    return this.createWebSessionForUser(user, idToken);
  }

  async onboardFarmerWithFirebase(
    dto: FirebaseOnboardFarmerDto,
  ): Promise<AuthResultDto> {
    const identity = await this.beginFirebaseOnboarding(
      dto.idToken,
      UserRole.Farmer,
    );
    if (await this.farmerProfileModel.exists({ cnic: dto.cnic })) {
      throw new ConflictException('CNIC is already registered');
    }

    const user = await this.createFirebaseUser(
      identity,
      UserRole.Farmer,
      dto.phone,
    );
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
    return this.buildAuthResult(user);
  }

  async onboardBuyerWithFirebase(
    dto: FirebaseOnboardBuyerDto,
  ): Promise<AuthResultDto> {
    const identity = await this.beginFirebaseOnboarding(
      dto.idToken,
      UserRole.Buyer,
    );
    if (await this.buyerProfileModel.exists({ cnic: dto.cnic })) {
      throw new ConflictException('CNIC is already registered');
    }

    const user = await this.createFirebaseUser(
      identity,
      UserRole.Buyer,
      dto.phone,
    );
    await this.createProfileOrRollback(user, () =>
      this.buyerProfileModel.create({
        userId: user._id,
        businessName: dto.businessName,
        businessType: dto.businessType,
        cnic: dto.cnic,
        addresses: dto.addresses ?? [],
      }),
    );
    return this.buildAuthResult(user);
  }

  async onboardTransporterWithFirebase(
    dto: FirebaseOnboardTransporterDto,
  ): Promise<AuthResultDto> {
    const identity = await this.beginFirebaseOnboarding(
      dto.idToken,
      UserRole.Transporter,
    );
    if (await this.transporterProfileModel.exists({ cnic: dto.cnic })) {
      throw new ConflictException('CNIC is already registered');
    }

    const user = await this.createFirebaseUser(
      identity,
      UserRole.Transporter,
      dto.phone,
    );
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
    return this.buildAuthResult(user);
  }

  async onboardFinancialPartnerWithFirebase(
    dto: FirebaseOnboardFinancialPartnerDto,
  ): Promise<AuthResultDto> {
    const identity = await this.beginPrivilegedFirebaseOnboarding(
      dto.idToken,
      UserRole.FinancialPartner,
    );
    if (await this.financialPartnerProfileModel.exists({ cnic: dto.cnic })) {
      throw new ConflictException('CNIC is already registered');
    }

    const user = await this.createFirebaseUser(
      identity,
      UserRole.FinancialPartner,
      dto.phone,
    );
    await this.createProfileOrRollback(user, () =>
      this.financialPartnerProfileModel.create({
        userId: user._id,
        institutionName: dto.institutionName,
        institutionType: dto.institutionType,
        licenseNumber: dto.licenseNumber,
        cnic: dto.cnic,
        designation: dto.designation,
        approvalLimit: dto.approvalLimit,
        serviceRegions: dto.serviceRegions ?? [],
      }),
    );
    return this.buildAuthResult(user);
  }

  async onboardFarmerForWeb(
    dto: FirebaseOnboardFarmerDto,
  ): Promise<WebSessionResult> {
    const result = await this.onboardFarmerWithFirebase(dto);
    return this.createWebSessionForAuthResult(result, dto.idToken);
  }

  async onboardBuyerForWeb(
    dto: FirebaseOnboardBuyerDto,
  ): Promise<WebSessionResult> {
    const result = await this.onboardBuyerWithFirebase(dto);
    return this.createWebSessionForAuthResult(result, dto.idToken);
  }

  async onboardTransporterForWeb(
    dto: FirebaseOnboardTransporterDto,
  ): Promise<WebSessionResult> {
    const result = await this.onboardTransporterWithFirebase(dto);
    return this.createWebSessionForAuthResult(result, dto.idToken);
  }

  async onboardFinancialPartnerForWeb(
    dto: FirebaseOnboardFinancialPartnerDto,
  ): Promise<WebSessionResult> {
    const result = await this.onboardFinancialPartnerWithFirebase(dto);
    return this.createWebSessionForAuthResult(result, dto.idToken);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve an existing account for a verified Firebase identity. Matches by
   * firebaseUid first; otherwise links a pre-existing account with the same
   * email (migration path for a user who previously had a local password).
   * Returns null when no account exists yet (caller triggers onboarding).
   */
  private async resolveFirebaseUser(
    identity: FirebaseIdentity,
  ): Promise<UserDocument | null> {
    const byUid = await this.userModel
      .findOne({ firebaseUid: identity.uid })
      .exec();
    if (byUid) {
      return byUid;
    }

    if (!identity.emailVerified) {
      throw new UnauthorizedException(
        'Firebase email must be verified before linking an existing account',
      );
    }

    const byEmail = await this.userModel
      .findOne({ email: identity.email.toLowerCase().trim() })
      .exec();
    if (byEmail) {
      byEmail.firebaseUid = identity.uid;
      byEmail.authProvider = identity.provider;
      if (identity.emailVerified && !byEmail.isVerified) {
        byEmail.isVerified = true;
      }
      await byEmail.save();
      return byEmail;
    }

    return null;
  }

  private async resolveFirebaseSignIn(idToken: string): Promise<UserDocument> {
    const identity = await this.firebaseAuthService.verifyIdToken(idToken);
    this.assertVerifiedIdentity(identity);
    const user = await this.resolveFirebaseUser(identity);

    if (user) {
      this.assertPrivilegedRoleAllowed(user, identity.email);
      if (!user.isActive) {
        throw new UnauthorizedException('Account has been deactivated');
      }
      return user;
    }

    if (this.isAllowlisted(identity.email, 'ADMIN_EMAIL_ALLOWLIST')) {
      return this.createFirebaseUser(identity, UserRole.Admin);
    }

    if (
      this.isAllowlisted(identity.email, 'FINANCIAL_PARTNER_EMAIL_ALLOWLIST')
    ) {
      throw new ConflictException({
        statusCode: 409,
        code: 'PRIVILEGED_ONBOARDING_REQUIRED',
        role: UserRole.FinancialPartner,
        message: 'Complete the required financial partner profile to continue.',
      });
    }

    throw new ConflictException({
      statusCode: 409,
      code: 'ONBOARDING_REQUIRED',
      message:
        'No Farm2Fork account is linked to this identity. Complete onboarding to choose a role.',
    });
  }

  /** Verify the Firebase token and guard first-time onboarding preconditions. */
  private async beginFirebaseOnboarding(
    idToken: string,
    role: UserRole,
  ): Promise<FirebaseIdentity> {
    this.assertSelfServiceRole(role);
    const identity = await this.firebaseAuthService.verifyIdToken(idToken);
    this.assertVerifiedIdentity(identity);

    return this.assertFirebaseIdentityIsUnlinked(identity);
  }

  private async beginPrivilegedFirebaseOnboarding(
    idToken: string,
    role: UserRole.FinancialPartner,
  ): Promise<FirebaseIdentity> {
    const identity = await this.firebaseAuthService.verifyIdToken(idToken);
    this.assertVerifiedIdentity(identity);
    if (
      !this.isAllowlisted(identity.email, 'FINANCIAL_PARTNER_EMAIL_ALLOWLIST')
    ) {
      throw new ForbiddenException(
        'This email is not allowlisted as a financial partner',
      );
    }
    return this.assertFirebaseIdentityIsUnlinked(identity);
  }

  private async assertFirebaseIdentityIsUnlinked(
    identity: FirebaseIdentity,
  ): Promise<FirebaseIdentity> {
    const email = identity.email.toLowerCase().trim();
    const [existingByUid, existingByEmail] = await Promise.all([
      this.userModel.exists({ firebaseUid: identity.uid }),
      this.userModel.exists({ email }),
    ]);
    if (existingByUid || existingByEmail) {
      throw new ConflictException('This account is already registered');
    }
    return identity;
  }

  private assertVerifiedIdentity(identity: FirebaseIdentity): void {
    if (!identity.emailVerified) {
      throw new UnauthorizedException(EMAIL_VERIFICATION_REQUIRED);
    }
  }

  private isAllowlisted(
    email: string,
    key: 'ADMIN_EMAIL_ALLOWLIST' | 'FINANCIAL_PARTNER_EMAIL_ALLOWLIST',
  ): boolean {
    const normalizedEmail = email.toLowerCase().trim();
    const entries = (this.configService.get<string>(key) ?? '')
      .split(',')
      .map((entry) => entry.toLowerCase().trim())
      .filter(Boolean);
    return entries.includes(normalizedEmail);
  }

  private assertPrivilegedRoleAllowed(user: UserDocument, email: string): void {
    if (
      user.role === UserRole.Admin &&
      !this.isAllowlisted(email, 'ADMIN_EMAIL_ALLOWLIST')
    ) {
      throw new UnauthorizedException('Admin access is no longer allowlisted');
    }
    if (
      user.role === UserRole.FinancialPartner &&
      !this.isAllowlisted(email, 'FINANCIAL_PARTNER_EMAIL_ALLOWLIST')
    ) {
      throw new UnauthorizedException(
        'Financial partner access is no longer allowlisted',
      );
    }
  }

  private async createWebSessionForAuthResult(
    result: AuthResultDto,
    idToken: string,
  ): Promise<WebSessionResult> {
    const sessionCookie = await this.createWebSessionCookie(idToken);
    return { user: result.user, sessionCookie };
  }

  private async createWebSessionForUser(
    user: UserDocument,
    idToken: string,
  ): Promise<WebSessionResult> {
    const sessionCookie = await this.createWebSessionCookie(idToken);
    return { user: this.toAuthUser(user), sessionCookie };
  }

  private createWebSessionCookie(idToken: string): Promise<string> {
    const ttlSeconds = this.configService.get<number>(
      'WEB_SESSION_TTL_SECONDS',
      86_400,
    );
    return this.firebaseAuthService.createSessionCookie(
      idToken,
      ttlSeconds * 1_000,
    );
  }

  private async createFirebaseUser(
    identity: FirebaseIdentity,
    role: UserRole,
    phone?: string,
  ): Promise<UserDocument> {
    try {
      return await this.userModel.create({
        email: identity.email.toLowerCase().trim(),
        firebaseUid: identity.uid,
        authProvider: identity.provider,
        role,
        phone,
        isVerified: identity.emailVerified,
      });
    } catch (error) {
      throw this.mapDuplicateKeyError(error);
    }
  }

  private assertSelfServiceRole(role: UserRole): void {
    if (!SELF_SERVICE_ROLES.includes(role)) {
      // Defense in depth: admin/financial_partner are never self-onboardable.
      throw new ForbiddenException('This role cannot self-register');
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
      if (field === 'firebaseUid') {
        return new ConflictException('This account is already registered');
      }
      return new ConflictException(`${field} already exists`);
    }
    return error;
  }
}
