import { beforeEach, describe, expect, jest, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigService } from '@nestjs/config';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('v1'),
          } satisfies Pick<ConfigService, 'get'>,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return health status', () => {
      const result = appController.health();
      expect(result.status).toBe('ok');
      expect(result).toHaveProperty('timestamp');
      expect(result.version).toBe('v1');
    });
  });
});
