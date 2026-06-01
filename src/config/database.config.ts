import { ConfigService } from '@nestjs/config';

export interface IDatabaseConfig {
  url: string;
}

export const databaseConfig = (): IDatabaseConfig => {
  const configService = new ConfigService();
  return {
    url:
      configService.get<string>('DATABASE_URL') ??
      'mongodb://localhost:27017/farm2fork',
  };
};
