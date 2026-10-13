# Firebase Auth Runtime Verification Record

Date: 2026-08-13

## Completed static and runtime checks

- Backend Compose accepts a complete, non-secret placeholder configuration via
  `docker compose config -q`.
- Backend Compose now requires the Firebase Admin credentials, Firebase project,
  cookie settings, and exact browser origins. It cannot silently start with
  Firebase authentication disabled.
- Web production build passed with all required `NEXT_PUBLIC_FIREBASE_*` build
  arguments present, and the web test suite passed (36 tests).
- Mobile static analysis and the full Flutter suite passed (79 tests).
- The current backend runtime initialized Firebase Admin for project
  `farm2fork-2a5b9`, connected to MongoDB Atlas and local Redis, and served
  Swagger on a temporary Docker port (`3002`).
- Browser CORS preflight from `http://localhost:3001` returned `204` with that
  exact allowed origin, credentials enabled, and the CSRF header allowed.
- The mobile Firebase exchange and web cookie-session exchange each rejected a
  deliberately invalid Firebase token with `401`; valid-origin browser requests
  passed CSRF/origin validation before reaching Firebase. Missing CSRF or a
  wrong origin returned `403`.

## Current local-runtime blocker

The backend and ignored local web environment files now contain the required
values. A stale development image/anonymous `node_modules` volume initially
lacked `cookie-parser`; the live smoke container uses the verified current
dependency tree while the clean image rebuild downloads dependencies. The
Dockerfile now pins pnpm and caches Corepack/pnpm downloads so later clean
builds resume reliably.

A real Firebase identity was intentionally not created or signed in during this
check. Therefore email delivery, Google consent, role onboarding, and a
successful authenticated session still require the manual matrix below.

## Required runtime variables

Supply these as Compose/CI environment variables; do not use `env_file` and do
not commit a service account:

```text
DATABASE_URL
REDIS_URL
FIREBASE_AUTH_ENABLED=true
FIREBASE_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT_JSON
CORS_ORIGIN=http://localhost:3001
WEB_APP_ORIGIN=http://localhost:3001
WEB_SESSION_TTL_SECONDS=86400
WEB_SESSION_COOKIE_NAME=f2f_session
WEB_SESSION_COOKIE_SECURE=false
```

For the web image build and runtime, supply:

```text
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
```

`CORS_ORIGIN` must include the exact `WEB_APP_ORIGIN`; production must use its
HTTPS web origin and `WEB_SESSION_COOKIE_SECURE=true`.

## Manual real-environment matrix

1. In Firebase Authentication, enable Email/Password and Google, and add the
   web development/production domains to Authorized domains.
2. On web, create a buyer, farmer, and transporter with email/password; confirm
   Firebase sends the verification email, then finish the existing KYC form.
3. On web and mobile, sign in with a new Google identity; choose a role and
   finish KYC. Confirm a returning Google identity restores the correct role.
4. On both clients, use password reset, complete it in Firebase, and sign in
   with the new password.
5. On web, reload after sign-in and confirm the HTTP-only cookie restores the
   backend role session. On mobile, restart the app and confirm the secure
   storage JWT restores the same backend role.
6. Confirm unknown, disabled, or unverified Firebase identities do not receive
   a backend session; privileged admin and financial-partner identities must
   already be allowlisted/provisioned.
