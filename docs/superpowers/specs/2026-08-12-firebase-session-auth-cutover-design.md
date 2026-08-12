# Firebase Session Auth Cutover Design

**Status:** Approved 2026-08-12

## Goal

Make Firebase Authentication the only authority for credentials, email verification, and password resets across the Farm2Fork web, mobile, and backend applications. Preserve Farm2Fork's MongoDB user, role, KYC, and account-activation authority.

## Problem Being Fixed

The current codebase mixes two identity systems. The backend still accepts local email/password credentials and issues Redis-backed verification/reset tokens; the web calls those endpoints. Mobile creates Firebase email/password users but does not send an email-verification message, and the backend permits an unverified Firebase identity to complete onboarding. The configured privileged-role allowlists are not enforced.

This is not a valid migration state. It permits divergent passwords, verification state, and role admission decisions.

## Authority Boundaries

| Concern | Authority |
| --- | --- |
| Email/password creation, sign-in, Google sign-in, verification email, password reset | Firebase Auth client SDK |
| Firebase token and Firebase session-cookie verification | Backend Firebase Admin SDK |
| Farm2Fork user record, profile/KYC, account activation, role authorization | Backend MongoDB services |
| Mobile API session transport | Existing Farm2Fork JWT in secure storage |
| Web API session transport | Firebase Admin HTTP-only session cookie |

The backend never accepts a password, creates a Firebase email/password account, or sends identity emails. Firebase Admin can manage identities, but client SDK email actions are the correct shared web/mobile path for verification and password reset.

## Public Self-Service Identity Flow

This flow applies only to `buyer`, `farmer`, and `transporter`.

1. The web or mobile Firebase SDK creates an email/password account, or signs the user in with Google.
2. For email/password registration, the client calls Firebase `sendEmailVerification` immediately and shows a verification-required state. Firebase action-code settings return to an approved Farm2Fork web/mobile URL.
3. No Farm2Fork user, profile, JWT, or web session cookie is created while Firebase reports `email_verified: false`.
4. The user opens the Firebase verification link, then returns to the client. The client reloads the Firebase user and requests a fresh ID token so its `email_verified` claim is current.
5. A verified first-time identity receives `ONBOARDING_REQUIRED`; it selects one self-service role and submits the matching profile/KYC data.
6. The backend verifies the refreshed Firebase ID token, requires `email_verified: true`, creates the MongoDB user/profile atomically, and establishes the platform's session.
7. A verified returning identity is resolved by `firebaseUid`, or linked once to a legacy MongoDB record whose normalized email matches. It then establishes the platform's session without recreating a profile.

Google identities proceed directly when Firebase reports a verified email. Email/password identities must not.

## Privileged Identity Flow

Users never send an admin or financial-partner role in a public request.

- A verified Firebase email in `ADMIN_EMAIL_ALLOWLIST` is provisioned as `admin` on first successful sign-in when no MongoDB record exists.
- A verified Firebase email in `FINANCIAL_PARTNER_EMAIL_ALLOWLIST` receives `PRIVILEGED_ONBOARDING_REQUIRED` with a server-derived `financial_partner` role. Only that allowlisted identity may submit the financial profile fields required by the schema: institution name/type, licence number, CNIC, optional designation, approval limit, and service regions.
- Any other unlinked identity receives `ONBOARDING_REQUIRED` for self-service roles only. It cannot select or create a privileged role.
- Existing privileged records must still have a verified Firebase identity and an allowlisted normalized email at sign-in. Removing an email from an allowlist blocks subsequent privileged sessions.

This makes the allowlist an admission control, not a client-side role switch.

## Web Session Design

The web client uses Firebase only to obtain an ID token at sign-in or onboarding. It initializes Firebase Auth with in-memory persistence. After the backend has created a web session, the client signs out of Firebase so no Firebase refresh state or backend token remains browser-readable.

The backend adds the following web-only endpoints:

| Endpoint | Input | Result |
| --- | --- | --- |
| `POST /api/auth/web/session` | verified Firebase ID token | Sets an HTTP-only Firebase Admin session cookie; returns sanitized Farm2Fork user only |
| `POST /api/auth/web/onboard/{buyer|farmer|transporter}` | verified Firebase ID token and profile | Creates user/profile, sets session cookie, returns sanitized user |
| `POST /api/auth/web/onboard/financial-partner` | verified Firebase ID token and financial profile | Requires allowlist, creates fixed privileged profile, sets cookie |
| `POST /api/auth/web/logout` | cookie session | Clears the cookie |
| `GET /api/auth/me` | cookie session or mobile Bearer JWT | Returns sanitized current user |

`POST /api/auth/firebase` and `POST /api/auth/firebase/onboard/*` remain mobile-only and retain their Farm2Fork JWT response shape. They enforce the same verified-email and privileged-role rules.

In production, the cookie is host-only and uses `__Host-f2f_session`, `Secure`, `HttpOnly`, `Path=/`, and `SameSite=Lax`. Local HTTP development uses a non-prefixed cookie with the same HttpOnly and SameSite settings but without `Secure`. Cookie expiry defaults to 24 hours and is configurable within Firebase's supported session-cookie range.

The backend authentication guard accepts either:

- a Farm2Fork JWT in `Authorization: Bearer ...` for mobile; or
- the Firebase Admin session cookie for web.

For a valid Firebase session cookie, the backend verifies the cookie, resolves its Firebase UID to the active MongoDB user, and uses that database role for every authorization decision. It checks revocation for the initial secure implementation.

## Web Request and CSRF Rules

The web API client uses `credentials: 'include'`; it never reads, writes, or forwards an access token. CORS allows credentials only for the exact `WEB_APP_ORIGIN`; wildcard origin is invalid when cookies are enabled.

Every unsafe browser request, including session creation, onboarding, logout, and API mutations, sends `X-Farm2Fork-CSRF: 1`. When cookie authentication is present, the backend additionally requires the request `Origin` to equal `WEB_APP_ORIGIN`. The custom header forces browser preflight, and the exact CORS allowlist prevents another origin from adding it. Mobile Bearer requests are exempt because browsers do not attach their secure-storage token automatically.

`SameSite=Lax` is a defense-in-depth control, not the sole CSRF control.

## Legacy Endpoint Retirement

The following backend routes, DTOs, service methods, Redis keys, tests, Swagger entries, and client callers are removed in this cutover:

- `POST /api/auth/register/buyer`
- `POST /api/auth/register/farmer`
- `POST /api/auth/register/transporter`
- `POST /api/auth/login`
- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/confirm`

The local `passwordHash` schema field and backend bcrypt dependency are removed after legacy methods are gone. Existing MongoDB users are migrated lazily: they create/sign into a Firebase account with the same email, verify that email, and are linked by the backend exactly once. No local password hash is copied to Firebase.

Web and mobile replace the retired routes in the same change set. Old deployed clients will no longer be supported by the backend after this cutover; release coordination is required.

## Cross-Platform UX

- **Web:** Firebase email/password and Google sign-in; verification-required screen with resend and refresh actions; Firebase password-reset action; role/profile onboarding; cookie-backed reload/session restoration; real admin and financial login instead of localStorage gates or hardcoded credentials.
- **Mobile:** Firebase email/password and Google sign-in; verification-required screen with resend and refresh actions; Firebase password-reset action; backend JWT only after verified onboarding/sign-in; no change to secure-storage ownership of that mobile JWT.
- **Backend:** identical verification, onboarding, allowlist, error-code, and account-linking rules for both platform transports; every public/authenticated endpoint remains represented in Swagger.

## Errors

- `401 EMAIL_VERIFICATION_REQUIRED`: Firebase identity is valid but its email is not verified; client presents verify/resend/refresh actions.
- `409 ONBOARDING_REQUIRED`: verified identity has no local Farm2Fork account and may select a self-service role.
- `409 PRIVILEGED_ONBOARDING_REQUIRED`: verified, allowlisted financial identity must complete only the financial profile.
- `403`: a user attempts a role outside the backend-derived role, is not allowlisted for a privileged role, or accesses a mismatched application.
- `401`: invalid, expired, revoked, inactive, or no-longer-allowlisted session.

## Verification

Backend tests prove unverified identities cannot link, onboard, establish web/mobile sessions, or create privileged accounts; verified allowlisted users receive only their server-derived role; cookie and Bearer extractors resolve the same active user rules; unsafe cookie requests require CSRF/origin checks; retired routes are absent from Swagger.

Web tests prove no backend token is stored in `sessionStorage` or local storage, all API requests use credentials and the CSRF header, Firebase is signed out after session creation, verification gates onboarding, and role mismatches are rejected.

Mobile tests prove email/password registration sends Firebase verification, unverified identities cannot onboard, token refresh after verification succeeds, Firebase reset is used, and existing mobile JWT/session behavior remains intact.
