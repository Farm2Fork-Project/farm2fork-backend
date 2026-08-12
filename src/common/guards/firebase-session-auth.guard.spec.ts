import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, jest } from '@jest/globals';
import { FirebaseAuthService } from '../../infrastructure/firebase/firebase-auth.service';
import { FirebaseSessionAuthGuard } from './firebase-session-auth.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('FirebaseSessionAuthGuard', () => {
  it('resolves an active user from a verified Firebase session cookie', async () => {
    const request: Record<string, unknown> = {
      cookies: { f2f_session: 'firebase-session-cookie' },
    };
    const firebaseAuth = {
      verifySessionCookie: jest.fn().mockResolvedValue({
        uid: 'firebase-1',
        email: 'buyer@example.com',
        emailVerified: true,
        provider: 'password',
      }),
    } as unknown as FirebaseAuthService;
    const userModel = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              _id: 'buyer-1',
              role: 'buyer',
              email: 'buyer@example.com',
              isActive: true,
            }),
          }),
        }),
      }),
    };
    const guard = new FirebaseSessionAuthGuard(
      firebaseAuth,
      userModel as never,
      new ConfigService({ WEB_SESSION_COOKIE_NAME: 'f2f_session' }),
    );

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'buyer-1',
      role: 'buyer',
      email: 'buyer@example.com',
    });
  });

  it('rejects a missing or invalid Firebase session cookie', async () => {
    const guard = new FirebaseSessionAuthGuard(
      { verifySessionCookie: jest.fn() } as unknown as FirebaseAuthService,
      { findOne: jest.fn() } as never,
      new ConfigService({ WEB_SESSION_COOKIE_NAME: 'f2f_session' }),
    );

    await expect(guard.canActivate(contextFor({ cookies: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
