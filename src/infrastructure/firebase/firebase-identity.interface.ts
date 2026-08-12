import { AuthProvider } from '../../common/enums/auth-provider.enum';

/**
 * Verified identity extracted from a Firebase ID token. This is the only shape
 * the rest of the backend sees - the raw Firebase DecodedIdToken never leaves
 * FirebaseAuthService.
 */
export interface FirebaseIdentity {
  /** Firebase Auth UID - stable primary identifier for the account. */
  uid: string;
  /** Verified email claim. Guaranteed present (tokens without email are rejected). */
  email: string;
  /** Whether Firebase considers the email verified (always true for Google). */
  emailVerified: boolean;
  /** Which provider signed the user in. */
  provider: AuthProvider;
}
