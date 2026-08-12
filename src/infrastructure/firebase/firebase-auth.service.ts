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
    if (!this.app) {
      // Misconfiguration (enabled but no credentials, or feature disabled).
      // Fail loudly at request time rather than silently accepting anything.
      throw new ServiceUnavailableException(
        'Firebase authentication is not configured on this server',
      );
    }

    // Loaded lazily so importing this class does not pull the firebase-admin
    // ESM dependency chain (jwks-rsa) into Jest's CommonJS transform at import
    // time. Node caches the module after the first call.
    const { getAuth } = await import('firebase-admin/auth');

    let decoded;
    try {
      decoded = await getAuth(this.app).verifyIdToken(idToken, true);
    } catch {
      // Never surface the underlying Firebase error detail to the client.
      throw new UnauthorizedException('Invalid or expired Firebase credential');
    }

    if (!decoded.email) {
      throw new UnauthorizedException('Firebase identity is missing an email');
    }

    const signInProvider = decoded.firebase?.sign_in_provider;
    return {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified ?? false,
      provider:
        signInProvider === 'password'
          ? AuthProvider.Password
          : AuthProvider.Google,
    };
  }
}
