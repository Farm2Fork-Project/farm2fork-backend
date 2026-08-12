# Firebase Mobile Integration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Firebase mobile authentication flow live by default, handle mapped Dio failures correctly, and prevent unverified Firebase emails from linking legacy backend accounts.

**Architecture:** The mobile app retains its existing Firebase gateway, API service, secure JWT storage, and bearer interceptor. This work corrects only the configuration defaults and the repository's understanding of Dio's wrapped error shape. The backend retains UID-first lookup but requires Firebase email verification before any email-based legacy-account migration.

**Tech Stack:** Flutter/Dart, Dio, Riverpod, Flutter Test, NestJS, Jest, Firebase Admin SDK.

## Global Constraints

- Work only on the existing `feature/firebase-auth` branches in mobile and backend; do not merge or push to `main`.
- Do not modify web Firebase/authentication work or implement FCM.
- Do not copy, inspect, or commit Firebase service-account secrets.
- Use small, related commits without the word Codex in commit messages or branch names.
- Keep the backend JWT bearer-token contract unchanged for mobile.

## File Structure

| File | Responsibility |
| --- | --- |
| `farm2fork-mobile/lib/core/config/app_config.dart` | Default live backend API path and mock-mode policy. |
| `farm2fork-mobile/test/core/config/app_config_test.dart` | Regression proof of the production-minded mobile defaults. |
| `farm2fork-mobile/lib/features/auth/data/repositories/api_auth_repository.dart` | Unwrap `ApiException` from Dio failures before auth control flow. |
| `farm2fork-mobile/test/auth/api_auth_repository_test.dart` | Exercise the real wrapped-Dio 409/401 paths. |
| `farm2fork-backend/src/modules/auth/auth.service.ts` | Reject unverified email-based legacy-account linking. |
| `farm2fork-backend/src/modules/auth/auth.service.spec.ts` | Prevent a regression that saves a Firebase UID for an unverified matching email. |

---

### Task 1: Make real mobile Firebase auth the default

**Files:**

- Modify: `farm2fork-mobile/lib/core/config/app_config.dart`
- Create: `farm2fork-mobile/test/core/config/app_config_test.dart`

**Interfaces:**

- Consumes: `AppConfig.apiBaseUrl` and `AppConfig.useMocks`.
- Produces: normal mobile builds use `http://10.0.2.2:3000/api` and `USE_MOCKS=false` unless explicitly overridden.

- [ ] **Step 1: Write the failing configuration-default tests**

  ```dart
  test('defaults to the backend API prefix on the Android emulator', () {
    expect(AppConfig.apiBaseUrl, 'http://10.0.2.2:3000/api');
  });

  test('uses real repositories unless mock mode is explicitly enabled', () {
    expect(AppConfig.useMocks, isFalse);
  });
  ```

- [ ] **Step 2: Run the test and verify it fails**

  Run: `flutter test test/core/config/app_config_test.dart`

  Expected: the current default URL lacks `/api` and `useMocks` is true.

- [ ] **Step 3: Change only the defaults**

  Set `apiBaseUrl` default to `http://10.0.2.2:3000/api` and `useMocks` default to `false`. Preserve both `--dart-define` keys and their documented override behavior.

- [ ] **Step 4: Run the focused configuration test**

  Run: `flutter test test/core/config/app_config_test.dart`

  Expected: PASS.

- [ ] **Step 5: Commit the mobile configuration correction**

  ```bash
  git -C /Users/macbook/UCP/FYP/farm2fork-mobile add lib/core/config/app_config.dart test/core/config/app_config_test.dart
  git -C /Users/macbook/UCP/FYP/farm2fork-mobile commit -m "fix: enable live mobile Firebase auth"
  ```

### Task 2: Handle the real Dio error wrapper in mobile auth

**Files:**

- Modify: `farm2fork-mobile/lib/features/auth/data/repositories/api_auth_repository.dart`
- Modify: `farm2fork-mobile/test/auth/api_auth_repository_test.dart`

**Interfaces:**

- Consumes: `DioException.error`, which the existing error interceptor sets to `ApiException`.
- Produces: `ApiAuthRepository` recognizes a wrapped 409 as `FirebaseOnboardingRequired` and a wrapped 401 as a stale-session signal.

- [ ] **Step 1: Write failing wrapped-Dio tests**

  Change the fake API to throw an `Object`, then add tests that throw:

  ```dart
  DioException(
    requestOptions: RequestOptions(path: '/auth/firebase'),
    error: const ApiException(ApiErrorKind.unknown, statusCode: 409),
  )
  ```

  Assert sign-in returns `FirebaseOnboardingRequired`. Add the equivalent wrapped 401 `/auth/me` case and assert token storage is cleared and `restoreSession` returns null.

- [ ] **Step 2: Run the focused repository test and verify it fails**

  Run: `flutter test test/auth/api_auth_repository_test.dart`

  Expected: the wrapped `DioException` is rethrown because the repository catches only `ApiException`.

- [ ] **Step 3: Add a narrow unwrapping helper**

  In `ApiAuthRepository`, add a private helper that returns an `ApiException` for either a direct `ApiException` or a `DioException` whose `error` is an `ApiException`. Use it only in `restoreSession` and `_exchange`; preserve all unrelated exceptions with their original stack trace.

- [ ] **Step 4: Run focused auth tests**

  Run: `flutter test test/auth/api_auth_repository_test.dart test/auth_controller_test.dart`

  Expected: PASS, including direct and wrapped 409/401 behavior.

- [ ] **Step 5: Commit the mobile error-boundary correction**

  ```bash
  git -C /Users/macbook/UCP/FYP/farm2fork-mobile add lib/features/auth/data/repositories/api_auth_repository.dart test/auth/api_auth_repository_test.dart
  git -C /Users/macbook/UCP/FYP/farm2fork-mobile commit -m "fix: handle Firebase auth API errors"
  ```

### Task 3: Require a verified Firebase email before legacy linking

**Files:**

- Modify: `farm2fork-backend/src/modules/auth/auth.service.ts`
- Modify: `farm2fork-backend/src/modules/auth/auth.service.spec.ts`

**Interfaces:**

- Consumes: `FirebaseIdentity.emailVerified` from `FirebaseAuthService.verifyIdToken`.
- Produces: `signInWithFirebase()` rejects an unverified identity that only matches a legacy account by email, without saving `firebaseUid` or `authProvider`.

- [ ] **Step 1: Write the failing unverified-email link test**

  In the `signInWithFirebase` suite, set the mocked identity's `emailVerified` to false and return a legacy user for the email lookup. Assert an unauthorized error and assert the user save method was not called.

- [ ] **Step 2: Run the focused backend test and verify it fails**

  Run: `pnpm test -- auth.service.spec.ts`

  Expected: failure because the current resolver assigns and saves Firebase identity fields.

- [ ] **Step 3: Add the verification guard**

  In `resolveFirebaseUser`, after the UID lookup and before the email lookup can link an account, throw `UnauthorizedException` when `identity.emailVerified` is false. Do not change the UID-first path.

- [ ] **Step 4: Run the focused backend auth suite**

  Run: `pnpm test -- auth.service.spec.ts`

  Expected: PASS, including linked-UID, verified-email migration, and unverified-email rejection cases.

- [ ] **Step 5: Commit the backend linking correction**

  ```bash
  git -C /Users/macbook/UCP/FYP/farm2fork-backend add src/modules/auth/auth.service.ts src/modules/auth/auth.service.spec.ts
  git -C /Users/macbook/UCP/FYP/farm2fork-backend commit -m "fix: require verified Firebase email for linking"
  ```

### Task 4: Verify both real integration boundaries

**Files:**

- No production changes.

**Interfaces:**

- Consumes: the completed mobile and backend corrections.
- Produces: focused evidence that the code-level Firebase integration contract is intact; Firebase project credentials and live account smoke remain outside this task.

- [ ] **Step 1: Run mobile static analysis and focused auth tests**

  Run:

  ```bash
  flutter analyze lib/app/bootstrap.dart lib/core/config/app_config.dart lib/core/network lib/features/auth
  flutter test test/core/config/app_config_test.dart test/auth/api_auth_repository_test.dart test/auth_controller_test.dart
  ```

  Expected: no analysis findings and all selected tests pass.

- [ ] **Step 2: Run backend build and focused auth tests**

  Run:

  ```bash
  CI=true pnpm run build
  pnpm test -- auth.service.spec.ts
  ```

  Expected: Nest build and auth tests pass.

- [ ] **Step 3: Review the intended changes only**

  Run in both repositories:

  ```bash
  git diff --check
  git status --short
  ```

  Expected: only committed source/test/doc changes plus the pre-existing backend build artifacts and package store. Do not stage those artifacts.

