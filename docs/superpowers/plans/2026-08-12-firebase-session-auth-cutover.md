# Firebase Session Auth Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Firebase the sole identity authority across web, mobile, and backend, with verified-email onboarding, secure Firebase web sessions, backend JWT mobile sessions, and server-derived privileged roles.

**Architecture:** The backend verifies Firebase credentials and owns Farm2Fork records/roles. Browser Firebase sign-in is ephemeral: a verified ID token is exchanged for a Firebase Admin HTTP-only session cookie; mobile exchanges the same verified identity for the existing backend JWT. Web uses credentialed requests and CSRF/origin checks; mobile continues to use its secure-storage Bearer token.

**Tech Stack:** NestJS 11, Firebase Admin 14, Passport/Jest, Next.js 16/React 19/Vitest, Firebase JS SDK, Flutter/Firebase Auth/Riverpod.

## Global Constraints

- Do not store any backend access token in web `sessionStorage`, `localStorage`, or client state.
- Firebase is the only credential, verification-email, and password-reset authority.
- Buyer/farmer/transporter onboarding requires a Firebase ID token whose `email_verified` claim is true.
- Admin and financial-partner roles are derived only by backend allowlists; no public request chooses them.
- Mobile keeps the Farm2Fork Bearer JWT in secure storage; web uses only the Firebase session cookie.
- All new or changed backend endpoints must be represented in Swagger.
- CORS must never combine credentials with a wildcard origin.
- Keep commits small and related; work only on `feature/firebase-session-auth`; do not push directly to `main`.

---

## File Structure

### Backend

- `src/infrastructure/firebase/firebase-auth.service.ts` — add Firebase Admin session-cookie creation and verification alongside ID-token verification.
- `src/common/guards/firebase-session-auth.guard.ts` — resolve an HTTP-only Firebase session cookie to an active MongoDB user.
- `src/common/guards/csrf.guard.ts` — enforce origin plus `X-Farm2Fork-CSRF` for unsafe browser-cookie requests.
- `src/common/guards/jwt-auth.guard.ts`, `src/app.module.ts`, `src/main.ts` — select Bearer vs cookie authentication, register CSRF, parse cookies, validate `WEB_APP_ORIGIN`, and set credentialed CORS.
- `src/modules/auth/auth.service.ts`, `auth.controller.ts`, `dto/*.ts`, `schemas/user.schema.ts` — implement web session/onboarding, verified identity and allowlist rules, and remove local-password paths.
- `src/modules/auth/**/*.spec.ts`, `src/common/guards/*.spec.ts`, `src/swagger-document.spec.ts` — prove authorization, endpoint, and contract changes.
- `package.json`, `pnpm-lock.yaml`, `docker-compose.yml`, `.env.example` — required cookie parsing/configuration and runtime variables.

### Web

- `lib/firebase/client.ts` — singleton Firebase client initialized from `NEXT_PUBLIC_FIREBASE_*` values using in-memory persistence.
- `lib/auth/firebase-web-auth-repository.ts` — Firebase sign-in, verification/resend/reset, session exchange, onboarding, and Firebase sign-out after a successful session exchange.
- `lib/api/client.ts`, `lib/auth/web-session.ts`, `lib/auth/role-auth-repository.ts`, `lib/buyer/buyer-repository.ts` — remove token persistence/bearer injection; use credentials, CSRF header, cookie-backed `/auth/me`, and role checks.
- `app/page.tsx`, `app/farmer/page.tsx`, `app/transporter/page.tsx`, `app/admin/login/page.tsx`, `app/financial/page.tsx`, and their login/signup components — use the shared Firebase auth repository, verification-required state, and backend-authorized roles.
- `Dockerfile`, `docker-compose.yml`, `.env.example`, `package.json`, `lib/**/*.test.ts` — Firebase client config/build args and focused repository/client tests.

### Mobile

- `lib/features/auth/data/services/firebase_auth_gateway.dart` — create account, send/reload verification, refresh ID token, and request Firebase password resets.
- `lib/features/auth/data/repositories/{auth_repository.dart,api_auth_repository.dart}` — represent verification-required and privileged-onboarding outcomes while retaining backend JWT storage.
- `lib/features/auth/presentation/{providers,models,screens}` and `lib/app/router.dart` — show verification/resend/refresh/reset states and route only verified identities into backend onboarding.
- `test/auth/*.dart`, `test/auth_controller_test.dart` — cover the new gateway/repository/controller states without platform channels.

## Task 1: Backend Firebase session and request-security foundation

**Files:**
- Create: `src/common/guards/firebase-session-auth.guard.ts`
- Create: `src/common/guards/firebase-session-auth.guard.spec.ts`
- Create: `src/common/guards/csrf.guard.ts`
- Create: `src/common/guards/csrf.guard.spec.ts`
- Modify: `src/infrastructure/firebase/firebase-auth.service.ts`
- Modify: `src/common/guards/jwt-auth.guard.ts`
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`
- Modify: `package.json`, `pnpm-lock.yaml`, `docker-compose.yml`, `.env.example`

**Consumes:** existing `FirebaseIdentity`, `User` model, `RequestUser`, and `FIREBASE_APP`.

**Produces:** `FirebaseAuthService.createSessionCookie(idToken, expiresInMs)`, `FirebaseAuthService.verifySessionCookie(cookie)`, cookie-authenticated `RequestUser`, and a global CSRF guard that permits mobile Bearer requests but rejects unsafe browser-cookie requests without an exact origin and `X-Farm2Fork-CSRF: 1`.

- [ ] **Step 1: Write failing backend guard/service tests**

```ts
it('resolves an active user from a verified Firebase session cookie', async () => {
  firebaseAuth.verifySessionCookie.mockResolvedValue({ uid: 'firebase-1', email: 'buyer@example.com', emailVerified: true, provider: AuthProvider.Password });
  userModel.findOne.mockReturnValue(query({ _id: 'buyer-1', role: UserRole.Buyer, email: 'buyer@example.com', isActive: true }));

  await expect(guard.canActivate(contextWithCookie('f2f_session', 'cookie'))).resolves.toBe(true);
  expect(request.user).toEqual({ id: 'buyer-1', role: UserRole.Buyer, email: 'buyer@example.com' });
});

it('rejects an unsafe cookie request without the CSRF header and web origin', () => {
  expect(() => guard.canActivate(contextFor({ method: 'POST', cookies: { f2f_session: 'x' } }))).toThrow(ForbiddenException);
});
```

- [ ] **Step 2: Run the new tests and verify they fail because the guards/session methods do not exist**

Run: `CI=true pnpm test -- firebase-session-auth.guard.spec.ts csrf.guard.spec.ts`

Expected: failing compilation/import assertions for the new guards and session-cookie methods.

- [ ] **Step 3: Implement the minimal session and request-security foundation**

```ts
// firebase-auth.service.ts
async createSessionCookie(idToken: string, expiresInMs: number): Promise<string> {
  const { getAuth } = await import('firebase-admin/auth');
  return getAuth(this.requiredApp()).createSessionCookie(idToken, { expiresIn: expiresInMs });
}

async verifySessionCookie(sessionCookie: string): Promise<FirebaseIdentity> {
  const { getAuth } = await import('firebase-admin/auth');
  const decoded = await getAuth(this.requiredApp()).verifySessionCookie(sessionCookie, true);
  return this.toIdentity(decoded);
}

// csrf.guard.ts
if (UNSAFE_METHODS.has(request.method) && (request.headers.origin || request.cookies[sessionCookieName])) {
  if (request.headers.origin !== webAppOrigin || request.headers['x-farm2fork-csrf'] !== '1') {
    throw new ForbiddenException('Invalid browser request origin');
  }
}
```

Use `cookie-parser` and its types as direct dependencies. Add `WEB_APP_ORIGIN`, `WEB_SESSION_TTL_SECONDS`, and cookie-name/security configuration with secure production defaults. `main.ts` must reject `CORS_ORIGIN='*'` when web credentials are enabled and configure `credentials: true` with only explicit origins.

- [ ] **Step 4: Run focused tests and type checks**

Run: `CI=true pnpm test -- firebase-session-auth.guard.spec.ts csrf.guard.spec.ts && pnpm run build`

Expected: all new tests pass and Nest compiles.

- [ ] **Step 5: Commit the security foundation**

```bash
git add package.json pnpm-lock.yaml docker-compose.yml .env.example src/common/guards src/infrastructure/firebase src/app.module.ts src/main.ts
git commit -m "feat(auth): add Firebase web session security"
```

## Task 2: Backend identity rules and web/mobile session contracts

**Files:**
- Create: `src/modules/auth/dto/web-session.dto.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/dto/firebase-auth.dto.ts`
- Modify: `src/modules/auth/dto/auth-response.dto.ts`
- Modify: `src/modules/auth/dto/index.ts`
- Modify: `src/modules/auth/auth.service.spec.ts`
- Modify: `src/swagger-document.spec.ts`

**Consumes:** Task 1 session service/guard and `ADMIN_EMAIL_ALLOWLIST` / `FINANCIAL_PARTNER_EMAIL_ALLOWLIST` configuration.

**Produces:** verified-only mobile Firebase responses; `/auth/web/session`, `/auth/web/onboard/*`, and `/auth/web/logout`; sanitized web responses without an access token; exact `EMAIL_VERIFICATION_REQUIRED`, `ONBOARDING_REQUIRED`, and `PRIVILEGED_ONBOARDING_REQUIRED` errors.

- [ ] **Step 1: Write failing auth-service and Swagger tests**

```ts
it('does not create an onboarding record for an unverified Firebase email', async () => {
  firebaseAuth.verifyIdToken.mockResolvedValue({ ...identity, emailVerified: false });
  await expect(service.onboardBuyerWithFirebase(dto)).rejects.toMatchObject({ response: { code: 'EMAIL_VERIFICATION_REQUIRED' } });
  expect(userModel.create).not.toHaveBeenCalled();
});

it('provisions only an allowlisted admin on first verified sign-in', async () => {
  firebaseAuth.verifyIdToken.mockResolvedValue({ ...identity, email: 'admin@example.com', emailVerified: true });
  await expect(service.signInWithFirebase('id-token')).resolves.toMatchObject({ user: { role: UserRole.Admin } });
});

expectPublic(document, '/api/auth/web/session', 'post', '200');
expectPublic(document, '/api/auth/register/buyer', 'post', undefined);
```

- [ ] **Step 2: Run tests and verify the current implementation permits the unverified path and exposes legacy routes**

Run: `CI=true pnpm test -- modules/auth/auth.service.spec.ts swagger-document.spec.ts`

Expected: the unverified onboarding and absent-route assertions fail.

- [ ] **Step 3: Implement contract and role rules**

```ts
private assertVerifiedIdentity(identity: FirebaseIdentity): void {
  if (!identity.emailVerified) {
    throw new UnauthorizedException({ code: 'EMAIL_VERIFICATION_REQUIRED', message: 'Verify your Firebase email before continuing.' });
  }
}

async createWebSession(idToken: string): Promise<AuthUserDto> {
  const user = await this.resolveVerifiedFirebaseUser(idToken);
  const cookie = await this.firebaseAuthService.createSessionCookie(idToken, this.webSessionTtlMs);
  return { user: this.toAuthUser(user), cookie };
}
```

Add controller response-cookie handling with `@Res({ passthrough: true })`; return only `AuthUserDto` on web routes. Route financial onboarding only after allowlist-derived role selection. Admin is auto-created only after verified token plus allowlist. Apply the verified assertion before existing-user resolution and before every onboarding method. Preserve mobile JWT output only on mobile Firebase routes.

- [ ] **Step 4: Run backend behavior, Swagger, and build checks**

Run: `CI=true pnpm test -- modules/auth/auth.service.spec.ts swagger-document.spec.ts && pnpm run build`

Expected: verified/allowlist/session tests pass, Swagger includes web routes and omits retired routes, and the build passes.

- [ ] **Step 5: Commit backend session contracts**

```bash
git add src/modules/auth src/swagger-document.spec.ts
git commit -m "feat(auth): enforce Firebase identity sessions"
```

## Task 3: Retire backend local-password identity paths

**Files:**
- Delete: `src/modules/auth/dto/login.dto.ts`
- Delete: `src/modules/auth/dto/password-reset.dto.ts`
- Delete: `src/modules/auth/dto/verify-email.dto.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/schemas/user.schema.ts`
- Modify: `src/modules/auth/dto/register.dto.ts`
- Modify: `src/modules/auth/dto/index.ts`
- Modify: `src/modules/auth/auth.service.spec.ts`
- Modify: `package.json`, `pnpm-lock.yaml`

**Consumes:** Task 2’s Firebase-only contract.

**Produces:** no local password hash, bcrypt, Redis verification/reset logic, DTO, Swagger route, or callable legacy endpoint.

- [ ] **Step 1: Write failing absence and migration-link tests**

```ts
it('links a verified Firebase identity to an existing local record without reading passwordHash', async () => {
  firebaseAuth.verifyIdToken.mockResolvedValue({ ...identity, emailVerified: true });
  userModel.findOne.mockReturnValueOnce(query(null)).mockReturnValueOnce(query(legacyUser));
  await service.signInWithFirebase('id-token');
  expect(legacyUser.firebaseUid).toBe(identity.uid);
});

expect(document.paths['/api/auth/login']).toBeUndefined();
expect(document.paths['/api/auth/password-reset/request']).toBeUndefined();
```

- [ ] **Step 2: Run tests and verify legacy implementation is still present**

Run: `CI=true pnpm test -- modules/auth/auth.service.spec.ts swagger-document.spec.ts`

Expected: endpoint-absence assertions fail before removal.

- [ ] **Step 3: Remove legacy code and dependencies**

```ts
// user.schema.ts: delete passwordHash and all passwordHash JSON transform references.
// auth.controller.ts: delete register, login, verify-email, resend-verification, and password-reset routes.
// auth.service.ts: delete bcrypt imports, Redis token constants, local registration/login/reset methods, and email stubs.
```

Remove `bcrypt` and `@types/bcrypt` with `pnpm remove bcrypt @types/bcrypt`, then retain Redis only for its remaining application modules.

- [ ] **Step 4: Run full backend verification**

Run: `CI=true pnpm run build && pnpm test`

Expected: Nest build succeeds and all backend suites pass with no references to retired endpoints.

- [ ] **Step 5: Commit legacy retirement**

```bash
git add package.json pnpm-lock.yaml src
git commit -m "refactor(auth): retire local credential endpoints"
```

## Task 4: Web Firebase client and cookie-backed repositories

**Files:**
- Create: `lib/firebase/client.ts`
- Create: `lib/firebase/client.test.ts`
- Create: `lib/auth/firebase-web-auth-repository.ts`
- Create: `lib/auth/firebase-web-auth-repository.test.ts`
- Modify: `lib/api/client.ts`
- Modify: `lib/api/client.test.ts`
- Modify: `lib/auth/web-session.ts`, `lib/auth/web-session.test.ts`
- Modify: `lib/auth/role-auth-repository.ts`, `lib/auth/role-auth-repository.test.ts`
- Modify: `lib/buyer/buyer-repository.ts`
- Modify: `package.json`, `pnpm-lock.yaml`, `.env.example`, `Dockerfile`, `docker-compose.yml`

**Consumes:** Task 2 endpoint shapes and backend web cookie/CSRF rules.

**Produces:** an in-memory Firebase sign-in client; `FirebaseWebAuthRepository`; credentials-including API client with the CSRF header; a session representation containing only a sanitized user.

- [ ] **Step 1: Write failing Vitest cases for token-free requests and Firebase session exchange**

```ts
test('ApiClient includes credentials and the CSRF header without an Authorization header', async () => {
  await new ApiClient({ baseUrl: 'http://localhost:3000/api', fetchFn }).request('/auth/me', { method: 'POST' });
  expect(fetchFn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ credentials: 'include' }));
  expect(headers.get('Authorization')).toBeNull();
  expect(headers.get('X-Farm2Fork-CSRF')).toBe('1');
});

test('web session exchange signs Firebase out after the backend sets the cookie', async () => {
  await repository.signInWithEmail({ email: 'buyer@example.com', password: 'Password1!' });
  expect(api.request).toHaveBeenCalledWith('/auth/web/session', expect.anything());
  expect(firebase.signOut).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the focused tests and verify they fail against bearer/sessionStorage behavior**

Run: `pnpm test -- lib/api/client.test.ts lib/auth/firebase-web-auth-repository.test.ts lib/auth/web-session.test.ts`

Expected: failures because the Firebase repository does not exist and the current client adds a Bearer header.

- [ ] **Step 3: Implement Firebase client, repositories, and runtime configuration**

```ts
await setPersistence(auth, inMemoryPersistence);
const credential = await signInWithEmailAndPassword(auth, email, password);
const idToken = await credential.user.getIdToken(true);
const user = await api.request<ApiAuthUser>('/auth/web/session', { method: 'POST', body: { idToken } });
await signOut(auth);
return { user };
```

`webSession` may hold only the sanitized user for immediate UI state; it must not write browser storage. Configure `firebase` as a direct dependency and pass `NEXT_PUBLIC_FIREBASE_*` build-time values through Docker without exposing any Admin credential.

- [ ] **Step 4: Run web unit checks**

Run: `pnpm test -- lib/api/client.test.ts lib/auth/firebase-web-auth-repository.test.ts lib/auth/web-session.test.ts lib/auth/role-auth-repository.test.ts && pnpm run build`

Expected: focused Vitest tests and Next production build pass.

- [ ] **Step 5: Commit web auth foundation**

```bash
git add package.json pnpm-lock.yaml Dockerfile docker-compose.yml .env.example lib
git commit -m "feat(auth): add Firebase web sessions"
```

## Task 5: Web role UI migration and privileged access gates

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/farmer/page.tsx`
- Modify: `app/transporter/page.tsx`
- Modify: `app/admin/login/page.tsx`
- Modify: `app/financial/page.tsx`
- Modify: `components/LoginScreen.tsx`
- Modify: `components/SignUpFormScreen.tsx`
- Modify: `components/farmer/FarmerSignup2.tsx`
- Modify: `components/transporter/TransporterSignup1Screen.tsx`, `components/transporter/TransporterSignup2Screen.tsx`
- Modify: `components/admin/AdminLayout.tsx`, `components/admin/Sidebar.tsx`
- Modify: `components/financial/LoginScreen.tsx`, `components/financial/LoanDetailScreen.tsx`
- Create: `components/auth/EmailVerificationRequired.tsx`
- Create: `components/auth/FinancialPartnerOnboarding.tsx`

**Consumes:** Task 4 `FirebaseWebAuthRepository` outcomes and Task 2 backend role/error contracts.

**Produces:** real Firebase login/sign-up/verification/reset actions for buyer/farmer/transporter; allowlist-derived admin and financial access; no localStorage/sessionStorage role gates.

- [ ] **Step 1: Write failing component/repository integration tests**

```tsx
test('verification-required signup does not navigate to a buyer dashboard', async () => {
  repository.signUpWithEmail.mockResolvedValue({ kind: 'verification_required', email: 'buyer@example.com' });
  render(<HomeContent repository={repository} />);
  await user.click(screen.getByRole('button', { name: /sign up/i }));
  expect(screen.getByText(/verify your email/i)).toBeInTheDocument();
  expect(repository.currentUser).not.toHaveBeenCalled();
});

test('admin layout rejects a cookie-authenticated non-admin user', async () => {
  api.me.mockResolvedValue({ role: 'buyer' });
  render(<AdminLayout />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/login'));
});
```

- [ ] **Step 2: Run tests and verify current pages use local/session storage or legacy repository methods**

Run: `pnpm test -- app app/admin components/auth`

Expected: tests fail before shared Firebase outcomes and server role checks replace local storage.

- [ ] **Step 3: Wire the shared UI flow**

```tsx
const outcome = await auth.signUpWithEmail({ email, password });
if (outcome.kind === 'verification_required') setVerificationEmail(outcome.email);

const user = await auth.refreshVerifiedIdentity();
if (user.role !== expectedRole) throw new ApiError(403, `This account cannot access the ${expectedRole} application.`);
```

On verification success, render the existing role-specific profile form and call only `/auth/web/onboard/...`. Use Firebase `sendPasswordResetEmail` for forgot-password. Admin login calls the same session exchange and only navigates after `/auth/me` reports `admin`. Financial login handles server-returned privileged onboarding with a role fixed by the backend.

- [ ] **Step 4: Run web tests and build**

Run: `pnpm test && pnpm run build`

Expected: all web tests pass, no role or token key remains in browser storage, and Next builds.

- [ ] **Step 5: Commit the web UI migration**

```bash
git add app components lib
git commit -m "feat(auth): connect web Firebase onboarding"
```

## Task 6: Mobile Firebase verification, reset, and outcome consistency

**Files:**
- Modify: `lib/features/auth/data/services/firebase_auth_gateway.dart`
- Modify: `lib/features/auth/data/services/auth_api_service.dart`
- Modify: `lib/features/auth/data/repositories/auth_repository.dart`
- Modify: `lib/features/auth/data/repositories/api_auth_repository.dart`
- Modify: `lib/features/auth/data/models/onboarding_request.dart`
- Modify: `lib/features/auth/presentation/providers/auth_controller.dart`
- Modify: `lib/features/auth/presentation/providers/onboarding_session.dart`
- Modify: `lib/features/auth/presentation/screens/login_screen.dart`
- Create: `lib/features/auth/presentation/screens/email_verification_screen.dart`
- Modify: `lib/app/router.dart`, `lib/l10n/app_en.arb`, `lib/l10n/app_ur.arb`, and generated localization output
- Modify: `test/auth/api_auth_repository_test.dart`, `test/auth_controller_test.dart`
- Create: `test/auth/firebase_auth_gateway_test.dart`

**Consumes:** Task 2 mobile error codes and verified-only backend onboarding contract.

**Produces:** email/password account creation that sends Firebase verification before backend onboarding; refresh/resend/reset actions; mobile role outcomes matching web/backend; unchanged secure-storage JWT use after successful mobile session creation.

- [ ] **Step 1: Write failing gateway/repository/controller tests**

```dart
test('email signup sends Firebase verification and does not call backend onboarding', () async {
  await repository.beginEmailSignUp(email: 'buyer@example.com', password: 'Password1!');
  expect(gateway.sendEmailVerificationCalls, 1);
  expect(api.onboardCalls, isEmpty);
});

test('verification refresh exchanges a forced-refresh ID token only after Firebase reports verified', () async {
  gateway.emailVerified = true;
  await repository.completeVerification();
  expect(gateway.lastForceRefresh, isTrue);
});
```

- [ ] **Step 2: Run tests and verify current registration returns an ID token without sending verification**

Run: `flutter test test/auth/firebase_auth_gateway_test.dart test/auth/api_auth_repository_test.dart test/auth_controller_test.dart`

Expected: new tests fail because gateway verification/reset methods and outcomes do not exist.

- [ ] **Step 3: Implement shared Firebase lifecycle and UI states**

```dart
final credential = await _auth.createUserWithEmailAndPassword(email: email, password: password);
await credential.user!.sendEmailVerification(actionCodeSettings);
return FirebaseVerificationRequired(email: email);

await _auth.currentUser!.reload();
final refreshed = await _auth.currentUser!.getIdToken(true);
if (_auth.currentUser!.emailVerified != true) {
  throw const AuthGatewayException(AuthGatewayError.emailNotVerified);
}
```

The verification screen supports resend, refresh, and sign-out. The login screen calls `sendPasswordResetEmail` through the gateway. Only verified identities route to existing self-service onboarding; add a fixed financial-partner onboarding route for the server-issued privileged outcome. Regenerate localization output after adding English and Urdu messages.

- [ ] **Step 4: Run Flutter analysis and full tests**

Run: `flutter analyze lib/app lib/features/auth && flutter test`

Expected: analysis reports no diagnostics in modified auth paths and the complete Flutter suite passes.

- [ ] **Step 5: Commit mobile auth migration**

```bash
git add lib test
git commit -m "feat(auth): verify Firebase mobile identities"
```

## Task 7: Integrated runtime configuration and cross-platform contract verification

**Files:**
- Modify: backend `.env.example`, `docker-compose.yml`, `docs/superpowers/specs/2026-08-12-firebase-session-auth-cutover-design.md`
- Modify: web `.env.example`, `Dockerfile`, `docker-compose.yml`
- Modify: mobile setup documentation if generated Firebase action-code/authorized-domain settings need recording
- Create: backend `test/auth-web-session.e2e-spec.ts` when the existing e2e harness permits a cookie jar

**Consumes:** Tasks 1–6.

**Produces:** one documented local Docker contract: backend accepts web requests from `http://localhost:3001`, web receives Firebase public configuration at build time, and mobile continues to target `/api`; an executable web-cookie session regression test.

- [ ] **Step 1: Write a failing e2e cookie session contract**

```ts
it('sets a HttpOnly session cookie for the web endpoint and accepts it on /auth/me', async () => {
  firebaseAdmin.verifyIdToken.mockResolvedValue(verifiedIdentity);
  const login = await request(app.getHttpServer())
    .post('/api/auth/web/session')
    .set('Origin', 'http://localhost:3001')
    .set('X-Farm2Fork-CSRF', '1')
    .send({ idToken: 'firebase-token' });

  expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
  await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', login.headers['set-cookie']).expect(200);
});
```

- [ ] **Step 2: Run the contract test and verify it fails until all layers agree**

Run: `CI=true pnpm test:e2e -- auth-web-session.e2e-spec.ts`

Expected: failure before the final compose/configuration and endpoint integration are complete.

- [ ] **Step 3: Apply final configuration and documentation**

```yaml
# backend docker-compose.yml
WEB_APP_ORIGIN: ${WEB_APP_ORIGIN:?WEB_APP_ORIGIN is required}
WEB_SESSION_TTL_SECONDS: ${WEB_SESSION_TTL_SECONDS:-86400}

# web docker-compose.yml build args
NEXT_PUBLIC_API_BASE_URL: ${NEXT_PUBLIC_API_BASE_URL:?NEXT_PUBLIC_API_BASE_URL is required}
NEXT_PUBLIC_FIREBASE_API_KEY: ${NEXT_PUBLIC_FIREBASE_API_KEY:?NEXT_PUBLIC_FIREBASE_API_KEY is required}
```

Document Firebase console prerequisites: Email/Password and Google providers enabled, `localhost` and deployment domains authorized, email templates configured, and action-code continue URLs authorized. Do not put service-account JSON or any Firebase Admin secret in web/mobile configuration.

- [ ] **Step 4: Run the final verification matrix**

Run: `CI=true pnpm run build && pnpm test && pnpm test:e2e -- auth-web-session.e2e-spec.ts` in backend; `pnpm test && pnpm run build` in web; `flutter analyze lib/app lib/features/auth && flutter test` in mobile.

Expected: all three application verification commands exit 0.

- [ ] **Step 5: Commit runtime integration documentation**

```bash
git add .env.example docker-compose.yml docs test
git commit -m "docs: configure Firebase session runtime"
```

## Plan Self-Review

- Spec coverage: Tasks 1–3 implement the backend security/session/retirement requirements; Tasks 4–5 implement the web cookie flow and all web role surfaces; Task 6 implements matching mobile verification and session behavior; Task 7 verifies the shared runtime contract.
- Endpoint coverage: Task 2 updates controller DTOs and Swagger; Task 3 proves retired routes are absent; Task 7 verifies the web cookie endpoint end-to-end.
- Security coverage: Task 1 handles session verification, exact CORS and CSRF/origin protection; Task 4 removes web Bearer/sessionStorage exposure; Task 6 retains mobile secure storage only.
- Type consistency: mobile endpoints continue to return `AuthResultDto`; web endpoints return `AuthUserDto` plus cookie; all callers use `FirebaseIdentity` and backend-derived roles.
