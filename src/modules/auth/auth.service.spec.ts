import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { AuthService } from './auth.service';
import { BusinessType } from './schemas/buyer-profile.schema';
import { BuyerProfile } from './schemas/buyer-profile.schema';
import { FarmerProfile } from './schemas/farmer-profile.schema';
import { TransporterProfile } from './schemas/transporter-profile.schema';
import { User } from './schemas/user.schema';

/** Minimal awaitable-with-exec stand-in for a Mongoose query. */
const query = <T>(value: T) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn<() => Promise<T>>().mockResolvedValue(value),
  then: (resolve: (v: T) => unknown) => Promise.resolve(value).then(resolve),
});

const makeUser = (overrides: Record<string, unknown> = {}) => ({
  _id: { toString: () => 'user-123' },
  email: 'farmer@example.com',
  role: UserRole.Farmer,
  phone: undefined,
  isVerified: false,
  isActive: true,
  passwordHash: '',
  ...overrides,
});

describe('AuthService', () => {
  let service: AuthService;
  let userModel: Record<string, jest.Mock>;
  let farmerModel: Record<string, jest.Mock>;
  let buyerModel: Record<string, jest.Mock>;
  let transporterModel: Record<string, jest.Mock>;
  let jwt: { sign: jest.Mock };
  let redis: Record<string, jest.Mock>;

  beforeEach(async () => {
    userModel = {
      exists: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
    };
    farmerModel = { exists: jest.fn(), create: jest.fn() };
    buyerModel = { exists: jest.fn(), create: jest.fn() };
    transporterModel = { exists: jest.fn(), create: jest.fn() };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    redis = {
      get: jest.fn(),
      set: jest.fn().mockReturnValue(Promise.resolve('OK')),
      del: jest.fn().mockReturnValue(Promise.resolve(1)),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(FarmerProfile.name), useValue: farmerModel },
        { provide: getModelToken(BuyerProfile.name), useValue: buyerModel },
        {
          provide: getModelToken(TransporterProfile.name),
          useValue: transporterModel,
        },
        { provide: JwtService, useValue: jwt },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('registerFarmer', () => {
    const dto = {
      email: 'Farmer@Example.com',
      password: 'StrongP@ss1',
      farmName: 'Green Acres',
      cnic: '35202-1234567-1',
    };

    beforeEach(() => {
      userModel.exists.mockReturnValue(query(null));
      farmerModel.exists.mockReturnValue(Promise.resolve(null));
      userModel.create.mockReturnValue(Promise.resolve(makeUser()));
      farmerModel.create.mockReturnValue(Promise.resolve({}));
    });

    it('hashes the password (never stores plaintext) and creates the profile', async () => {
      await service.registerFarmer(dto);

      const created = userModel.create.mock.calls[0][0] as {
        email: string;
        passwordHash: string;
        role: UserRole;
      };
      expect(created.email).toBe('farmer@example.com'); // normalised
      expect(created.role).toBe(UserRole.Farmer);
      expect(created.passwordHash).not.toBe(dto.password);
      await expect(
        bcrypt.compare(dto.password, created.passwordHash),
      ).resolves.toBe(true);
      expect(farmerModel.create).toHaveBeenCalledTimes(1);
    });

    it('returns a signed token and a sanitised user view', async () => {
      const result = await service.registerFarmer(dto);
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user).toEqual({
        id: 'user-123',
        email: 'farmer@example.com',
        role: UserRole.Farmer,
        phone: undefined,
        isVerified: false,
        isActive: true,
      });
      expect(jwt.sign).toHaveBeenCalledWith({
        sub: 'user-123',
        email: 'farmer@example.com',
        role: UserRole.Farmer,
      });
    });

    it('issues an email verification token in Redis', async () => {
      await service.registerFarmer(dto);
      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key] = redis.set.mock.calls[0] as [string];
      expect(key.startsWith('auth:verify:')).toBe(true);
    });

    it('rejects a duplicate email before creating anything', async () => {
      userModel.exists.mockReturnValue(query({ _id: 'x' }));
      await expect(service.registerFarmer(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate CNIC', async () => {
      farmerModel.exists.mockReturnValue(Promise.resolve({ _id: 'x' }));
      await expect(service.registerFarmer(dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('rolls back the user when profile creation fails', async () => {
      farmerModel.create.mockImplementation(() =>
        Promise.reject(new Error('boom')),
      );
      userModel.deleteOne.mockReturnValue(query({ deletedCount: 1 }));

      await expect(service.registerFarmer(dto)).rejects.toBeDefined();
      expect(userModel.deleteOne).toHaveBeenCalledWith({
        _id: expect.anything(),
      });
    });
  });

  describe('registerBuyer', () => {
    it('persists the buyer profile with its business type', async () => {
      userModel.exists.mockReturnValue(query(null));
      buyerModel.exists.mockReturnValue(Promise.resolve(null));
      userModel.create.mockReturnValue(
        Promise.resolve(makeUser({ role: UserRole.Buyer })),
      );
      buyerModel.create.mockReturnValue(Promise.resolve({}));

      await service.registerBuyer({
        email: 'buyer@example.com',
        password: 'StrongP@ss1',
        businessName: 'Fresh Mart',
        businessType: BusinessType.Retailer,
        cnic: '35202-1234567-2',
      });

      const profile = buyerModel.create.mock.calls[0][0] as {
        businessType: BusinessType;
      };
      expect(profile.businessType).toBe(BusinessType.Retailer);
    });
  });

  describe('login', () => {
    it('returns a token for valid credentials', async () => {
      const passwordHash = await bcrypt.hash('StrongP@ss1', 10);
      userModel.findOne.mockReturnValue(query(makeUser({ passwordHash })));

      const result = await service.login({
        email: 'farmer@example.com',
        password: 'StrongP@ss1',
      });
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    it('rejects an unknown email with a generic error', async () => {
      userModel.findOne.mockReturnValue(query(null));
      await expect(
        service.login({ email: 'nobody@example.com', password: 'x' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      const passwordHash = await bcrypt.hash('StrongP@ss1', 10);
      userModel.findOne.mockReturnValue(query(makeUser({ passwordHash })));
      await expect(
        service.login({ email: 'farmer@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a deactivated account', async () => {
      const passwordHash = await bcrypt.hash('StrongP@ss1', 10);
      userModel.findOne.mockReturnValue(
        query(makeUser({ passwordHash, isActive: false })),
      );
      await expect(
        service.login({ email: 'farmer@example.com', password: 'StrongP@ss1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('password reset', () => {
    it('returns a generic message and stores a token when the user exists', async () => {
      userModel.findOne.mockReturnValue(query(makeUser()));
      const result = await service.requestPasswordReset('farmer@example.com');
      expect(result.message).toMatch(/if the account exists/i);
      expect(redis.set).toHaveBeenCalledTimes(1);
    });

    it('returns the same generic message and stores nothing when the user is unknown', async () => {
      userModel.findOne.mockReturnValue(query(null));
      const result = await service.requestPasswordReset('nobody@example.com');
      expect(result.message).toMatch(/if the account exists/i);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('rejects confirming with an invalid token', async () => {
      redis.get.mockReturnValue(Promise.resolve(null));
      await expect(
        service.confirmPasswordReset({
          token: 'bad',
          newPassword: 'NewStrongP@ss1',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('updates the password hash on a valid token', async () => {
      redis.get.mockReturnValue(Promise.resolve('user-123'));
      userModel.updateOne.mockReturnValue(query({ modifiedCount: 1 }));

      await service.confirmPasswordReset({
        token: 'good',
        newPassword: 'NewStrongP@ss1',
      });

      const [filter, update] = userModel.updateOne.mock.calls[0] as [
        unknown,
        { $set: { passwordHash: string } },
      ];
      expect(filter).toEqual({ _id: 'user-123' });
      expect(update.$set.passwordHash).toBeDefined();
      await expect(
        bcrypt.compare('NewStrongP@ss1', update.$set.passwordHash),
      ).resolves.toBe(true);
      expect(redis.del).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyEmail', () => {
    it('rejects an invalid token', async () => {
      redis.get.mockReturnValue(Promise.resolve(null));
      await expect(service.verifyEmail('bad')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('marks the user verified on a valid token', async () => {
      redis.get.mockReturnValue(Promise.resolve('user-123'));
      userModel.updateOne.mockReturnValue(query({ modifiedCount: 1 }));
      const result = await service.verifyEmail('good');
      expect(result.verified).toBe(true);
      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: 'user-123' },
        { $set: { isVerified: true } },
      );
    });
  });
});
