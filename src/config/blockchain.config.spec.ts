import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { blockchainConfig } from './blockchain.config';

describe('blockchainConfig', () => {
  const originalEnabled = process.env.BLOCKCHAIN_WORKER_ENABLED;

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.BLOCKCHAIN_WORKER_ENABLED;
    else process.env.BLOCKCHAIN_WORKER_ENABLED = originalEnabled;
  });

  it('exposes worker configuration under the blockchain namespace', async () => {
    process.env.BLOCKCHAIN_WORKER_ENABLED = 'true';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [blockchainConfig],
        }),
      ],
    }).compile();

    expect(
      moduleRef.get(ConfigService).get<boolean>('blockchain.enabled'),
    ).toBe(true);

    await moduleRef.close();
  });
});
