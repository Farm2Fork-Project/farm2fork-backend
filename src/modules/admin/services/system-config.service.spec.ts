import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { SystemConfig } from '../schemas/system-config.schema';
import { SystemConfigService } from './system-config.service';

describe('SystemConfigService.getPlatformFeePercent', () => {
  let service: SystemConfigService;
  let model: { findOne: jest.Mock };

  function configReturns(value: unknown) {
    model.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest
          .fn()
          .mockResolvedValue(value === undefined ? null : { value }),
      }),
    });
  }

  beforeEach(async () => {
    model = { findOne: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SystemConfigService,
        { provide: getModelToken(SystemConfig.name), useValue: model },
      ],
    }).compile();
    service = moduleRef.get(SystemConfigService);
  });

  it('returns the stored numeric percent', async () => {
    configReturns(7.5);
    expect(await service.getPlatformFeePercent()).toBe(7.5);
  });

  it('coerces a numeric string', async () => {
    configReturns('8');
    expect(await service.getPlatformFeePercent()).toBe(8);
  });

  it('falls back to the default when the key is missing', async () => {
    configReturns(undefined);
    expect(await service.getPlatformFeePercent()).toBe(
      SystemConfigService.defaultPlatformFeePercent,
    );
  });

  it('falls back when the value is out of range', async () => {
    configReturns(150);
    expect(await service.getPlatformFeePercent()).toBe(
      SystemConfigService.defaultPlatformFeePercent,
    );
  });

  it('falls back when the value is non-numeric', async () => {
    configReturns('abc');
    expect(await service.getPlatformFeePercent()).toBe(
      SystemConfigService.defaultPlatformFeePercent,
    );
  });
});
