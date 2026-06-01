import { ConfigService } from '@nestjs/config';

export interface IRedisConfig {
  url: string;
}

export const redisConfig = (): IRedisConfig => {
  const configService = new ConfigService();
  return {
    url: configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
  };
};
