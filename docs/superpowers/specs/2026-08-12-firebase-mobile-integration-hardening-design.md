# Firebase Mobile Integration Hardening Design

## Goal

Make the completed Firebase mobile-to-backend authentication path usable in a normal
development build and close the two incorrect runtime error/identity boundaries
found during integration review.

## Scope

This slice changes only Firebase-auth integration in the existing `feature/firebase-auth`
branches of the mobile and backend repositories. It does not add FCM, web Firebase
authentication, HTTP-only cookies, or retire legacy backend password endpoints.

## Mobile runtime contract

The default mobile configuration will use the real repository and the Android-emulator
backend API base URL `http://10.0.2.2:3000/api`. Mock mode remains available only when
explicitly enabled with `--dart-define=USE_MOCKS=true`.

Mobile Firebase requests continue to post an ID token to these backend routes:

- `POST /api/auth/firebase`
- `POST /api/auth/firebase/onboard/farmer`
- `POST /api/auth/firebase/onboard/buyer`
- `POST /api/auth/firebase/onboard/transporter`

The backend JWT response remains in secure mobile storage and the existing bearer-token
interceptor continues to attach it to later API requests.

## Mobile error boundary

`ErrorInterceptor` deliberately maps transport failures into an `ApiException` stored
inside a `DioException`. `ApiAuthRepository` must unwrap that contained exception before
making control-flow decisions. It will:

- treat an unwrapped HTTP 409 as `FirebaseOnboardingRequired`;
- clear storage and return no session for an unwrapped HTTP 401 during session restore;
- rethrow all other errors without reclassifying them.

No global change to the existing Dio interceptor is needed; that would broaden behavior
for unrelated repositories.

## Backend identity-linking boundary

The backend may link a legacy account by matching email only after Firebase reports the
email as verified. A Firebase UID match remains sufficient because it is an already-linked
identity. An unverified identity that merely has the same email as a legacy account is
rejected with an unauthorized response; it is not linked and is not routed into onboarding,
where the existing email would otherwise cause a conflict.

## Testing and verification

Mobile tests will prove the default live configuration and exercise the actual
`DioException(error: ApiException(...))` shape for 409 onboarding and 401 session cleanup.
Backend tests will prove an unverified email cannot link a legacy account and does not
save a Firebase UID. Focused mobile and backend auth test suites will run after each
small implementation commit; source analysis/build verification will follow.

## Non-goals and operational prerequisite

The backend still requires `FIREBASE_AUTH_ENABLED=true` and a valid external service-account
credential at runtime. This design does not inspect, copy, or commit that secret. A live
Firebase account smoke test remains a separate user-controlled check after the branches are
published or integrated.
