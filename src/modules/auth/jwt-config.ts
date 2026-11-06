import { ConfigService } from '@nestjs/config';

export function jwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (
    config.get<string>('NODE_ENV') === 'production' &&
    (!secret ||
      secret.trim().length < 32 ||
      /^(dev-insecure-secret|replace-with|change-?me)/i.test(secret.trim()))
  ) {
    throw new Error(
      'JWT_SECRET must be a configured random secret of at least 32 characters in production.',
    );
  }
  return secret ?? 'dev-insecure-secret';
}
