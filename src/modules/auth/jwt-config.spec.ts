import { ConfigService } from '@nestjs/config';
import { jwtSecret } from './jwt-config';

describe('JWT release configuration', () => {
  it.each([
    undefined,
    '',
    'short',
    'dev-insecure-secret',
    'replace-with-a-long-random-secret',
  ])('rejects unsafe production secret %s', (secret) => {
    expect(() =>
      jwtSecret(
        new ConfigService({ NODE_ENV: 'production', JWT_SECRET: secret }),
      ),
    ).toThrow('JWT_SECRET');
  });
  it('accepts a configured production secret and preserves local defaults', () => {
    expect(
      jwtSecret(
        new ConfigService({
          NODE_ENV: 'production',
          JWT_SECRET: 'b9c71a4e08f26d35a7c903e16f482b60',
        }),
      ),
    ).toBe('b9c71a4e08f26d35a7c903e16f482b60');
    expect(jwtSecret(new ConfigService({ NODE_ENV: 'test' }))).toBe(
      'dev-insecure-secret',
    );
  });
});
