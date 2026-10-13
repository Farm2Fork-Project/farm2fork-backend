import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from '@jest/globals';
import { CsrfGuard } from './csrf.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const config = new ConfigService({
    WEB_APP_ORIGIN: 'http://localhost:3001',
    WEB_SESSION_COOKIE_NAME: 'f2f_session',
  });

  it('rejects an unsafe cookie request without the exact origin and CSRF header', () => {
    const guard = new CsrfGuard(config);

    expect(() =>
      guard.canActivate(
        contextFor({
          method: 'POST',
          headers: { origin: 'http://attacker.example' },
          cookies: { f2f_session: 'cookie' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows an unsafe request with the configured origin and CSRF header', () => {
    const guard = new CsrfGuard(config);

    expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          headers: {
            origin: 'http://localhost:3001',
            'x-farm2fork-csrf': '1',
          },
          cookies: { f2f_session: 'cookie' },
        }),
      ),
    ).toBe(true);
  });

  it('allows a mobile Bearer request without browser headers', () => {
    const guard = new CsrfGuard(config);

    expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          headers: { authorization: 'Bearer mobile-token' },
          cookies: {},
        }),
      ),
    ).toBe(true);
  });
});
