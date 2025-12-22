import { ConfigService } from '@nestjs/config';

export interface ISwaggerConfig {
  enabled: boolean;
  title: string;
  description: string;
  version: string;
  path: string;
}

export const swaggerConfig = (): ISwaggerConfig => {
  const configService = new ConfigService();
  return {
    enabled: configService.get('SWAGGER_ENABLED', true),
    title: 'Farm2Fork API',
    description: 'Farm2Fork API Documentation',
    version: configService.get('API_VERSION', 'v1'),
    path: configService.get('SWAGGER_PATH', 'api/docs'),
  };
};
