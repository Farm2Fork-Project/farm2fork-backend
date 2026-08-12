import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { App } from 'firebase-admin/app';
import { AuthProvider } from '../../common/enums/auth-provider.enum';
import { FIREBASE_APP } from './firebase.constants';
import { FirebaseIdentity } from './firebase-identity.interface';

/**
 * Verifies Firebase ID tokens using the Admin SDK. The backend trusts a token
 * only after this check, then mints its own JWT (backend remains the authority
 * for roles, sessions, and profile/KYC data).
 */
@Injectable()
export class FirebaseAuthService {
  constructor(@Inject(FIREBASE_APP) private readonly app: App | null) {}

  /** True when the Admin SDK is configured and ready to verify tokens. */
  isConfigured(): boolean {
    return this.app !== null;
  }

  async verifyIdToken(idToken: string): Promise<FirebaseIdentity> {
    const app = this.requiredApp();
    const { getAuth } = await this.loadAuth();
    let decoded;
    try {
      decoded = await getAuth(app).verifyIdToken(idToken, true);
    } catch {
      // Never surface the underlying Firebase error detail to the client.
      throw new UnauthorizedException('Invalid or expired Firebase credential');
    }
    return this.toIdentity(decoded);
  }

  /**
   * Mint an HTTP-only Firebase Admin session cookie from a verified ID token.
   * Used only by the web transport; mobile receives a Farm2Fork JWT instead.
   */
  async createSessionCookie(
    idToken: string,
    expiresInMs: number,
  ): Promise<string> {
    const app = this.requiredApp();
    const { getAuth } = await this.loadAuth();
    return getAuth(app).createSessionCookie(idToken, {
      expiresIn: expiresInMs,
    });
  }

  /** Verify an HTTP-only Firebase session cookie (with revocation check). */
  async verifySessionCookie(sessionCookie: string): Promise<FirebaseIdentity> {
    const app = this.requiredApp();
    const { getAuth } = await this.loadAuth();
    let decoded;
    try {
      decoded = await getAuth(app).verifySessionCookie(sessionCookie, true);
    } catch {
      throw new UnauthorizedException('Invalid or expired Firebase session');
    }
    return this.toIdentity(decoded);
  }

  private requiredApp(): App {
    if (!this.app) {
      // Misconfiguration (enabled but no credentials, or feature disabled).
      // Fail loudly at request time rather than silently accepting anything.
      throw new ServiceUnavailableException(
        'Firebase authentication is not configured on this server',
      );
    }
    return this.app;
  }

  // Loaded lazily so importing this class does not pull the firebase-admin ESM
  // dependency chain (jwks-rsa) into Jest's CommonJS transform at import time.
  // Node caches the module after the first call.
  private loadAuth() {
    return import('firebase-admin/auth');
  }

  private toIdentity(decoded: {
    uid: string;
    email?: string;
    email_verified?: boolean;
    firebase?: { sign_in_provider?: string };
  }): FirebaseIdentity {
    if (!decoded.email) {
      throw new UnauthorizedException('Firebase identity is missing an email');
    }
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified ?? false,
      provider:
        decoded.firebase?.sign_in_provider === 'password'
          ? AuthProvider.Password
          : AuthProvider.Google,
    };
  }
}
