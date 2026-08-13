import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { FirebaseAuthService } from '../../infrastructure/firebase/firebase-auth.service';
import { AuthProvider } from '../../common/enums/auth-provider.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuthService } from './auth.service';
import { BuyerProfile, BusinessType } from './schemas/buyer-profile.schema';
import { FarmerProfile } from './schemas/farmer-profile.schema';
import {
  FinancialPartnerProfile,
  InstitutionType,
} from './schemas/financial-partner-profile.schema';
import { TransporterProfile } from './schemas/transporter-profile.schema';
import { User } from './schemas/user.schema';

const query = <T>(value: T) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn<() => Promise<T>>().mockResolvedValue(value),
  then: (resolve: (result: T) => unknown) =>
    Promise.resolve(value).then(resolve),
});

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'user-123' },
  email: 'farmer@example.com',
  role: UserRole.Farmer,
  isVerified: true,
  isActive: true,
  save: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
  ...overrides,
});

describe('AuthService Firebase identity contract', () => {
  let service: AuthService;
  let userModel: Record<string, jest.Mock>;
  let farmerModel: Record<string, jest.Mock>;
  let buyerModel: Record<string, jest.Mock>;
  let financialPartnerModel: Record<string, jest.Mock>;
  let firebaseAuth: {
    verifyIdToken: jest.Mock;
    createSessionCookie: jest.Mock;
  };
  let jwt: { sign: jest.Mock };

  const identity = {
    uid: 'firebase-uid-1',
    email: 'farmer@example.com',
    emailVerified: true,
    provider: AuthProvider.Google,
  };

  beforeEach(async () => {
    userModel = {
      exists: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      deleteOne: jest.fn(),
    };
    farmerModel = { exists: jest.fn(), create: jest.fn() };
    buyerModel = { exists: jest.fn(), create: jest.fn() };
    financialPartnerModel = { exists: jest.fn(), create: jest.fn() };
    firebaseAuth = {
      verifyIdToken: jest.fn(),
      createSessionCookie: jest
        .fn()
        .mockResolvedValue('firebase.session.cookie'),
    };
    jwt = { sign: jest.fn().mockReturnValue('mobile.backend.jwt') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(FarmerProfile.name), useValue: farmerModel },
        { provide: getModelToken(BuyerProfile.name), useValue: buyerModel },
        {
          provide: getModelToken(TransporterProfile.name),
          useValue: { exists: jest.fn(), create: jest.fn() },
        },
        {
          provide: getModelToken(FinancialPartnerProfile.name),
          useValue: financialPartnerModel,
        },
        { provide: JwtService, useValue: jwt },
        { provide: FirebaseAuthService, useValue: firebaseAuth },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            ADMIN_EMAIL_ALLOWLIST: 'admin@example.com',
            FINANCIAL_PARTNER_EMAIL_ALLOWLIST: 'finance@example.com',
            WEB_SESSION_TTL_SECONDS: 86_400,
          }),
        },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('mints a mobile JWT for a verified Firebase-linked user', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue(identity);
    userModel.findOne.mockReturnValue(
      query(makeUser({ firebaseUid: identity.uid })),
    );

    await expect(service.signInWithFirebase('id-token')).resolves.toMatchObject(
      {
        accessToken: 'mobile.backend.jwt',
        user: { role: UserRole.Farmer },
      },
    );
  });

  it('links a verified Firebase identity to a legacy matching-email user', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue(identity);
    const legacy = makeUser({ isVerified: false });
    userModel.findOne
      .mockReturnValueOnce(query(null))
      .mockReturnValueOnce(query(legacy));

    await service.signInWithFirebase('id-token');

    expect(legacy).toMatchObject({
      firebaseUid: identity.uid,
      authProvider: AuthProvider.Google,
      isVerified: true,
    });
    expect(legacy.save).toHaveBeenCalledTimes(1);
  });

  it('rejects an unverified Firebase identity before sign-in or account linking', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue({
      ...identity,
      emailVerified: false,
    });

    await expect(service.signInWithFirebase('id-token')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'EMAIL_VERIFICATION_REQUIRED',
      }),
    });
    expect(userModel.findOne).not.toHaveBeenCalled();
  });

  it('provisions an admin only for a verified allowlisted email', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue({
      ...identity,
      email: 'admin@example.com',
    });
    userModel.findOne
      .mockReturnValueOnce(query(null))
      .mockReturnValueOnce(query(null));
    userModel.create.mockResolvedValue(
      makeUser({ email: 'admin@example.com', role: UserRole.Admin }),
    );

    await expect(service.signInWithFirebase('id-token')).resolves.toMatchObject(
      {
        user: { role: UserRole.Admin },
      },
    );
    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firebaseUid: identity.uid,
        role: UserRole.Admin,
      }),
    );
  });

  it('requires financial-partner onboarding for a verified allowlisted identity', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue({
      ...identity,
      email: 'finance@example.com',
    });
    userModel.findOne
      .mockReturnValueOnce(query(null))
      .mockReturnValueOnce(query(null));

    await expect(service.signInWithFirebase('id-token')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PRIVILEGED_ONBOARDING_REQUIRED',
        role: UserRole.FinancialPartner,
      }),
    });
  });

  it('returns an HTTP-only-web-session value without exposing a mobile JWT', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue(identity);
    userModel.findOne.mockReturnValue(
      query(makeUser({ firebaseUid: identity.uid })),
    );

    await expect(service.createWebSession('id-token')).resolves.toEqual({
      user: expect.objectContaining({ id: 'user-123', role: UserRole.Farmer }),
      sessionCookie: 'firebase.session.cookie',
    });
    expect(firebaseAuth.createSessionCookie).toHaveBeenCalledWith(
      'id-token',
      86_400_000,
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('creates a verified Firebase farmer account and profile', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue(identity);
    userModel.exists.mockReturnValue(query(null));
    farmerModel.exists.mockResolvedValue(null);
    userModel.create.mockResolvedValue(makeUser({ firebaseUid: identity.uid }));
    farmerModel.create.mockResolvedValue({});

    await service.onboardFarmerWithFirebase({
      idToken: 'id-token',
      farmName: 'Green Acres',
      cnic: '35202-1234567-1',
    });

    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firebaseUid: identity.uid,
        role: UserRole.Farmer,
        isVerified: true,
      }),
    );
    expect(farmerModel.create).toHaveBeenCalledTimes(1);
  });

  it('does not onboard an unverified Firebase identity', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue({
      ...identity,
      emailVerified: false,
    });

    await expect(
      service.onboardFarmerWithFirebase({
        idToken: 'id-token',
        farmName: 'Green Acres',
        cnic: '35202-1234567-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userModel.create).not.toHaveBeenCalled();
  });

  it('creates a financial-partner profile only for its allowlisted identity', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue({
      ...identity,
      email: 'finance@example.com',
    });
    userModel.exists.mockReturnValue(query(null));
    financialPartnerModel.exists.mockResolvedValue(null);
    userModel.create.mockResolvedValue(
      makeUser({
        email: 'finance@example.com',
        role: UserRole.FinancialPartner,
      }),
    );
    financialPartnerModel.create.mockResolvedValue({});

    await expect(
      service.onboardFinancialPartnerWithFirebase({
        idToken: 'id-token',
        institutionName: 'Farm2Fork Microfinance',
        institutionType: InstitutionType.Microfinance,
        licenseNumber: 'LIC-12345',
        cnic: '35202-1234567-1',
      }),
    ).resolves.toMatchObject({ user: { role: UserRole.FinancialPartner } });
  });

  it('signals self-service onboarding for an unlinked verified identity', async () => {
    firebaseAuth.verifyIdToken.mockResolvedValue(identity);
    userModel.findOne
      .mockReturnValueOnce(query(null))
      .mockReturnValueOnce(query(null));

    await expect(service.signInWithFirebase('id-token')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
