# Cross-Platform Firebase Auth Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver working email/password and Google Firebase authentication on web and mobile, with one verified-email and backend-authorized account lifecycle.

**Architecture:** Firebase owns credential creation, Google sign-in, verification email, refresh, and password reset. The backend verifies a refreshed Firebase ID token and owns Farm2Fork roles, KYC, active status, and browser-cookie or mobile-JWT sessions. Clients treat `EMAIL_VERIFICATION_REQUIRED`, `ONBOARDING_REQUIRED`, and `PRIVILEGED_ONBOARDING_REQUIRED` as distinct state transitions.

**Tech Stack:** Firebase JS SDK, Next.js 16, Firebase Auth Flutter SDK, Google Sign-In Flutter plugin, NestJS Firebase Admin endpoints, Vitest, Flutter tests.

## Global Constraints

- Never send a password to the Farm2Fork backend.
- Browser code uses only HTTP-only cookies; it never stores a Farm2Fork access token or role gate in browser storage.
- Mobile retains its backend JWT only in secure storage after backend authorization.
- Email/password registration sends Firebase verification before any Farm2Fork onboarding request.
- Admin and financial-partner admission remains backend allowlist-only.
- Keep related commits small; do not push directly to `main`.

### Task 1: Normalize the backend error contract

**Files:**
- Modify: `src/modules/auth/auth.service.spec.ts`
- Modify: `src/modules/auth/auth.service.ts` only if an error response lacks its documented `code`

**Produces:** Stable error codes for all clients: `EMAIL_VERIFICATION_REQUIRED`, `ONBOARDING_REQUIRED`, and `PRIVILEGED_ONBOARDING_REQUIRED`.

- [x] **Step 1: Add focused failing error-code tests**
- [x] **Step 2: Verify the tests fail only if a code is absent or incorrect**
- [x] **Step 3: Make the smallest backend correction, if required**
- [x] **Step 4: Run focused backend tests and build**
- [x] **Step 5: Commit any backend correction separately**

### Task 2: Complete the web Firebase lifecycle

**Files:**
- Modify: `lib/firebase/client.ts`, `lib/auth/firebase-web-auth-repository.ts`
- Modify: `app/page.tsx`, `app/farmer/page.tsx`, `app/transporter/page.tsx`
- Modify: `components/LoginScreen.tsx`, role onboarding forms
- Create/modify: focused Vitest tests

**Produces:** Email/password sign-up sends verification; unverified sign-in enters verify/resend/refresh; verified new email and Google identities select a self-service role then submit the existing KYC form; verified existing identities establish a cookie session. Google provider sign-in is available on every public role login surface.

- [x] **Step 1: Add failing repository tests for Google exchange and verification-required errors**
- [x] **Step 2: Add failing UI tests for the verify and Google entry points**
- [x] **Step 3: Implement the repository lifecycle and shared error decoding**
- [x] **Step 4: Wire the buyer, farmer, and transporter screens to it**
- [x] **Step 5: Run web tests and production build**
- [x] **Step 6: Commit the web lifecycle change**

### Task 3: Complete the mobile Firebase lifecycle

**Files:**
- Modify: `lib/features/auth/data/services/firebase_auth_gateway.dart`
- Modify: `lib/features/auth/data/repositories/{auth_repository.dart,api_auth_repository.dart}`
- Modify: `lib/features/auth/presentation/{providers,widgets,screens}`
- Modify: `test/auth/*.dart`, `test/auth_controller_test.dart`

**Produces:** Email/password registration sends verification and pauses before onboarding; email sign-in handles unverified status; verification resend plus refresh force a new Firebase ID token; Google identity onboarding uses the existing role/KYC screens; password reset is Firebase-only.

- [x] **Step 1: Add failing gateway/repository/controller tests for verification lifecycle**
- [x] **Step 2: Implement Firebase verification, token refresh, and password-reset gateway APIs**
- [x] **Step 3: Decode the backend verification error without treating all 409s alike**
- [x] **Step 4: Add verify/resend/refresh/reset mobile UI state**
- [x] **Step 5: Run Flutter formatting, analysis, and auth tests**
- [x] **Step 6: Commit the mobile lifecycle change**

### Task 4: Verify the shared runtime contract

**Files:**
- Modify: `.env.example` or Docker configuration only if a required public Firebase value is missing
- Create: a concise runtime verification record in this directory

**Produces:** Documented real-environment test matrix covering Firebase email verification, existing and new Google identity, backend role-derived onboarding, browser cookie session restoration, and mobile JWT restoration.

- [x] **Step 1: Verify backend and web Docker configuration share the exact allowed origin and Firebase project**
- [ ] **Step 2: Execute non-destructive authenticated smoke requests when Firebase credentials and the backend runtime are available**
- [x] **Step 3: Record executed checks, blocked external checks, and required manual device/browser checks**
- [x] **Step 4: Commit the verification record**

## Plan Self-Review

- Email/password, Google, verification, resend, refresh, reset, onboarding, returning session, and privileged-role boundaries are covered by Tasks 1–4.
- Web and mobile consume the same named backend outcomes; neither changes backend role authorization.
- No task adds credentials or backend tokens to browser storage, and mobile keeps its existing secure-storage boundary.
