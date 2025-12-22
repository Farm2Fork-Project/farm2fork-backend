import { ConfigService } from '@nestjs/config';

export interface IAppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  apiVersion: string;
}

export const appConfig = (): IAppConfig => {
  const configService = new ConfigService();
  return {
    nodeEnv: configService.get('NODE_ENV', 'development'),
    port: configService.get('PORT', 3000),
    apiPrefix: configService.get('API_PREFIX', 'api'),
    apiVersion: configService.get('API_VERSION', 'v1'),
  };
};
