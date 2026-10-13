import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '../../common/enums/user-role.enum';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditLog } from '../admin/schemas/audit-log.schema';
import { AccountService, maskCnic } from './account.service';
import { UpdateProfileDto } from './dto/profile.dto';
import { BuyerProfile } from './schemas/buyer-profile.schema';
import { FarmerProfile } from './schemas/farmer-profile.schema';
import { FinancialPartnerProfile } from './schemas/financial-partner-profile.schema';
import { TransporterProfile } from './schemas/transporter-profile.schema';
import { User } from './schemas/user.schema';

const query = <T>(value: T) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn<() => Promise<T>>().mockResolvedValue(value),
});

const objectId = '64b7f0c2a1b2c3d4e5f60718';
const makeUser = (overrides: Record<string, unknown> = {}) => ({
  _id: objectId,
  email: 'ayesha@example.com',
  role: UserRole.Buyer,
  isVerified: true,
  isActive: true,
  ...overrides,
});
const actorOf = (role: UserRole) => ({
  id: objectId,
  role,
  email: 'ayesha@example.com',
});

describe('AccountService', () => {
  let service: AccountService;
  let userModel: { findById: jest.Mock; updateOne: jest.Mock };
  let buyerModel: { findOne: jest.Mock; updateOne: jest.Mock };
  let farmerModel: { findOne: jest.Mock; updateOne: jest.Mock };
  let auditModel: { create: jest.Mock };
  let storage: { uploadAvatar: jest.Mock; deleteAvatar: jest.Mock };

  beforeEach(async () => {
    userModel = { findById: jest.fn(), updateOne: jest.fn() };
    buyerModel = { findOne: jest.fn(), updateOne: jest.fn() };
    farmerModel = { findOne: jest.fn(), updateOne: jest.fn() };
    auditModel = { create: jest.fn() };
    storage = { uploadAvatar: jest.fn(), deleteAvatar: jest.fn() };
    const none = { findOne: jest.fn(), updateOne: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(BuyerProfile.name), useValue: buyerModel },
        { provide: getModelToken(FarmerProfile.name), useValue: farmerModel },
        { provide: getModelToken(TransporterProfile.name), useValue: none },
        {
          provide: getModelToken(FinancialPartnerProfile.name),
          useValue: none,
        },
        { provide: getModelToken(AuditLog.name), useValue: auditModel },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = moduleRef.get(AccountService);

    userModel.findById.mockReturnValue(query(makeUser()));
    buyerModel.findOne.mockReturnValue(
      query({
        businessName: 'Khan Traders',
        businessType: 'retailer',
        cnic: '3520212345671',
      }),
    );
    userModel.updateOne.mockResolvedValue({ matchedCount: 1 });
    buyerModel.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it('returns the profile with a display name and a masked CNIC', async () => {
    const result = await service.getProfile(objectId);
    expect(result.displayName).toBe('Khan Traders');
    expect(result.profile).toMatchObject({
      kind: 'buyer',
      businessName: 'Khan Traders',
      businessType: 'retailer',
      cnicMasked: '*********5671',
    });
    expect(JSON.stringify(result)).not.toContain('3520212345671');
  });

  it('prefers the person name, then falls back to the email name', async () => {
    userModel.findById.mockReturnValue(
      query(makeUser({ fullName: 'Ayesha Khan' })),
    );
    expect((await service.getProfile(objectId)).displayName).toBe(
      'Ayesha Khan',
    );
    userModel.findById.mockReturnValue(query(makeUser()));
    buyerModel.findOne.mockReturnValue(query(null));
    expect((await service.getProfile(objectId)).displayName).toBe('ayesha');
  });

  it('rejects an account that no longer exists', async () => {
    userModel.findById.mockReturnValue(query(null));
    await expect(service.getProfile(objectId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('writes user fields and role fields to their own documents and audits field names only', async () => {
    await service.updateProfile(
      actorOf(UserRole.Buyer),
      {
        fullName: 'Ayesha Khan',
        phone: '+923001234567',
        businessName: 'Khan Traders Ltd',
      },
      '10.0.0.1',
    );
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: objectId },
      { $set: { fullName: 'Ayesha Khan', phone: '+923001234567' } },
    );
    expect(buyerModel.updateOne).toHaveBeenCalledWith(
      { userId: objectId },
      { $set: { businessName: 'Khan Traders Ltd' } },
    );
    const entry = auditModel.create.mock.calls[0][0] as {
      action: string;
      metadata: { after: { changedFields: string[] } };
    };
    expect(entry.action).toBe('profile.updated');
    expect(entry.metadata.after.changedFields).toEqual([
      'fullName',
      'phone',
      'businessName',
    ]);
    expect(JSON.stringify(entry)).not.toContain('+923001234567');
  });

  it('rejects fields that belong to another role', async () => {
    await expect(
      service.updateProfile(actorOf(UserRole.Buyer), { farmName: 'Farm' }),
    ).rejects.toThrow('farmName cannot be edited for the buyer role');
    expect(userModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects an empty update', async () => {
    await expect(
      service.updateProfile(actorOf(UserRole.Buyer), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores only the Cloudinary path for a new avatar', async () => {
    storage.uploadAvatar.mockResolvedValue(
      `v123/farm2fork/avatars/${objectId}`,
    );
    await service.setAvatar(actorOf(UserRole.Buyer), Buffer.from('img'));
    expect(storage.uploadAvatar).toHaveBeenCalledWith(
      Buffer.from('img'),
      objectId,
    );
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: objectId },
      { $set: { avatarPath: `v123/farm2fork/avatars/${objectId}` } },
    );
  });

  it('removes the avatar from the database and the CDN', async () => {
    userModel.findById.mockReturnValue(
      query(makeUser({ avatarPath: `v9/farm2fork/avatars/${objectId}` })),
    );
    await service.removeAvatar(actorOf(UserRole.Buyer));
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: objectId },
      { $unset: { avatarPath: 1 } },
    );
    expect(storage.deleteAvatar).toHaveBeenCalledWith(
      `v9/farm2fork/avatars/${objectId}`,
    );
  });

  it('does nothing when there is no avatar to remove', async () => {
    await service.removeAvatar(actorOf(UserRole.Buyer));
    expect(userModel.updateOne).not.toHaveBeenCalled();
    expect(storage.deleteAvatar).not.toHaveBeenCalled();
  });
});

describe('maskCnic', () => {
  it('keeps only the last four digits', () => {
    expect(maskCnic('35202-1234567-1')).toBe('*********5671');
    expect(maskCnic(undefined)).toBeUndefined();
    expect(maskCnic('12')).toBeUndefined();
  });
});

describe('UpdateProfileDto validation', () => {
  const check = (input: Record<string, unknown>) =>
    validate(plainToInstance(UpdateProfileDto, input), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('accepts a normal edit and trims names', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      fullName: '  Ayesha Khan ',
      phone: '+923001234567',
    });
    expect(dto.fullName).toBe('Ayesha Khan');
    expect(await check({ fullName: 'Ayesha Khan' })).toHaveLength(0);
  });

  it('rejects identity fields and bad values', async () => {
    expect((await check({ cnic: '35202-1234567-1' })).length).toBeGreaterThan(
      0,
    );
    expect((await check({ email: 'x@y.com' })).length).toBeGreaterThan(0);
    expect((await check({ fullName: 'A' })).length).toBeGreaterThan(0);
    expect((await check({ phone: 'call me' })).length).toBeGreaterThan(0);
    expect((await check({ businessType: 'spaceship' })).length).toBeGreaterThan(
      0,
    );
    expect((await check({ landSizeAcres: -1 })).length).toBeGreaterThan(0);
  });
});
