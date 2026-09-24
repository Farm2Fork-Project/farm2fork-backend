import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { FirebaseOnboardFarmerDto } from './dto/firebase-auth.dto';
import { FarmLocationDto } from './dto/register.dto';
import { FarmerProfileService } from './farmer-profile.controller';

const FARMER = new Types.ObjectId().toHexString();

function query(result: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  };
}

async function errorsFor<T extends object>(cls: new () => T, body: object) {
  return (await validate(plainToInstance(cls, body))).map((e) => e.property);
}

describe('farm location', () => {
  it('onboarding requires a complete farm location (street, city, province, pin)', async () => {
    const base = {
      idToken: 't',
      farmName: 'Green Valley',
      cnic: '35202-1234567-1',
    };

    expect(await errorsFor(FirebaseOnboardFarmerDto, base)).toContain(
      'farmLocation',
    );
    const partial = await validate(
      plainToInstance(FirebaseOnboardFarmerDto, {
        ...base,
        farmLocation: { address: 'Chak 5' },
      }),
    );
    expect(
      partial.flatMap((e) => e.children?.map((c) => c.property) ?? []),
    ).toEqual(expect.arrayContaining(['city', 'province', 'lat', 'lng']));
    expect(
      await errorsFor(FirebaseOnboardFarmerDto, {
        ...base,
        farmLocation: {
          address: 'Chak 5',
          city: 'Multan',
          province: 'Punjab',
          lat: 30.1575,
          lng: 71.5249,
        },
      }),
    ).toEqual([]);
  });

  it('only accepts Pakistani provinces and territories', async () => {
    expect(
      await errorsFor(FarmLocationDto, {
        address: 'Chak 5',
        city: 'Multan',
        province: 'Atlantis',
        lat: 30.1575,
        lng: 71.5249,
      }),
    ).toEqual(['province']);
  });

  it('rejects a pin outside Pakistan or with swapped coordinates', async () => {
    const base = { address: 'Chak 5', city: 'Multan', province: 'Punjab' };
    // London.
    expect(
      await errorsFor(FarmLocationDto, { ...base, lat: 51.5, lng: -0.12 }),
    ).toEqual(['lat', 'lng']);
    // Multan with lat/lng swapped.
    expect(
      await errorsFor(FarmLocationDto, { ...base, lat: 71.5249, lng: 30.1575 }),
    ).toEqual(['lat', 'lng']);
  });

  it('reports incomplete locations and saves a trimmed complete one', async () => {
    const model = {
      findOne: jest
        .fn()
        .mockReturnValue(query({ farmLocation: { address: 'Chak 5' } })),
      findOneAndUpdate: jest.fn().mockReturnValue(
        query({
          farmLocation: {
            address: 'Chak 5',
            city: 'Multan',
            province: 'Punjab',
            lat: 30.1575,
            lng: 71.5249,
          },
        }),
      ),
    };
    const service = new FarmerProfileService(model as never);

    await expect(service.getLocation(FARMER)).resolves.toEqual({
      address: 'Chak 5',
      city: undefined,
      province: undefined,
      complete: false,
    });
    const saved = await service.updateLocation(FARMER, {
      address: '  Chak 5 ',
      city: ' Multan ',
      province: 'Punjab',
      lat: 30.1575,
      lng: 71.5249,
    });
    expect(model.findOneAndUpdate.mock.calls[0][1]).toEqual({
      $set: {
        farmLocation: {
          address: 'Chak 5',
          city: 'Multan',
          province: 'Punjab',
          lat: 30.1575,
          lng: 71.5249,
        },
      },
    });
    expect(saved).toEqual(
      expect.objectContaining({ lat: 30.1575, lng: 71.5249, complete: true }),
    );
  });

  it('404s for a farmer without a profile', async () => {
    const service = new FarmerProfileService({
      findOne: jest.fn().mockReturnValue(query(null)),
    } as never);
    await expect(service.getLocation(FARMER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
