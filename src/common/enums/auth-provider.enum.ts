/**
 * Identity provider that authenticated a user through Firebase Auth.
 *
 * Farm2Fork uses Firebase as the credential front door (Google sign-in and
 * email/password). The backend verifies the Firebase ID token and then mints
 * its own JWT; this enum records which provider Firebase reported.
 */
export enum AuthProvider {
  Google = 'google',
  Password = 'password',
}

export const AUTH_PROVIDERS = [
  AuthProvider.Google,
  AuthProvider.Password,
] as const;
