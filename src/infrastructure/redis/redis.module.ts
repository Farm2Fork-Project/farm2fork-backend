import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url =
          configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';

        return new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        });
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule implements OnModuleDestroy {
  constructor(private readonly redisService: RedisService) {}

  async onModuleDestroy(): Promise<void> {
    await this.redisService.disconnect();
  }
}
