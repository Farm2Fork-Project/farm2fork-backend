import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FarmerProfile } from '../auth/schemas/farmer-profile.schema';
import { User } from '../auth/schemas/user.schema';
import { Order } from '../order/schemas/order.schema';
import { FarmProfileService } from './farm-profile.service';
import { Product } from './schemas/product.schema';

const FARMER_ID = '6a2fe77bb77795516febc111';

const leaned = (result: unknown) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(result),
});

describe('FarmProfileService', () => {
  let service: FarmProfileService;
  const profileModel = { findOne: jest.fn() };
  const userModel = { findOne: jest.fn() };
  const productModel = { countDocuments: jest.fn() };
  const orderModel = { countDocuments: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        FarmProfileService,
        { provide: getModelToken(FarmerProfile.name), useValue: profileModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Product.name), useValue: productModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
      ],
    }).compile();
    service = module.get(FarmProfileService);
    productModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(3),
    });
    orderModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(7),
    });
  });

  it('returns the public farm identity with counts and no private fields', async () => {
    profileModel.findOne.mockReturnValue(
      leaned({
        userId: new Types.ObjectId(FARMER_ID),
        farmName: 'Green Valley Farm',
        farmLocation: { city: 'Multan', province: 'Punjab' },
        cropTypes: ['wheat', 'mango'],
        landSizeAcres: 12,
        certifications: [
          { name: 'GlobalG.A.P.', expiryDate: new Date('2020-01-01') },
          { name: 'Organic', expiryDate: new Date('2999-01-01') },
          { issuedBy: 'nameless' },
        ],
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
    );
    userModel.findOne.mockReturnValue(
      leaned({ fullName: ' Ahmed Raza ', avatarPath: undefined }),
    );

    const result = await service.getPublicProfile(FARMER_ID);

    expect(result).toMatchObject({
      farmerId: FARMER_ID,
      farmName: 'Green Valley Farm',
      ownerName: 'Ahmed Raza',
      city: 'Multan',
      province: 'Punjab',
      cropTypes: ['wheat', 'mango'],
      landSizeAcres: 12,
      memberSince: '2026-01-02T00:00:00.000Z',
      stats: { activeListings: 3, completedOrders: 7 },
    });
    expect(result.certifications.map((c) => [c.name, c.expired])).toEqual([
      ['GlobalG.A.P.', true],
      ['Organic', false],
    ]);
    expect(Object.keys(result)).not.toEqual(
      expect.arrayContaining(['cnic', 'phone', 'email', 'bankAccountDetails']),
    );
    expect(profileModel.findOne.mock.calls[0]).toBeDefined();
  });

  it('404s for a malformed id, a missing profile or a non-farmer user', async () => {
    await expect(service.getPublicProfile('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    profileModel.findOne.mockReturnValue(leaned(null));
    userModel.findOne.mockReturnValue(leaned({ fullName: 'x' }));
    await expect(service.getPublicProfile(FARMER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    profileModel.findOne.mockReturnValue(
      leaned({ farmName: 'F', createdAt: new Date() }),
    );
    userModel.findOne.mockReturnValue(leaned(null));
    await expect(service.getPublicProfile(FARMER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
