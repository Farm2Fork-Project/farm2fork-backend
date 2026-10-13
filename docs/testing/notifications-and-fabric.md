# Notification and Fabric delivery verification — 2026-10-11

## Implemented clients

Web and mobile notification settings now offer a real notification inbox, refresh,
mark-all-read and explicit push opt-in/disable. English and Urdu controls replace
the former local-only preference toggles. The backend still stores one FCM token
per account: enabling a second device moves push delivery to that device. In-app
notifications remain stored independently of device permission or FCM success.

Web requests browser permission only from Enable push notifications, registers an
FCM token through the authenticated/CSRF-protected device-token endpoint, and uses
a same-origin Firebase messaging service worker for background messages. Prior
opt-in is scoped to the account and refreshed on session restore/browser resume.
Foreground messages display in the application; background notification clicks
open the application. Disable and sign-out clear the backend binding before
removing the SDK token. Failed registration/cleanup remains retryable.

Mobile uses the official Firebase Messaging SDK, secure per-account opt-in storage,
registration on session restore, token-refresh registration, foreground messages,
and background/cold-start notification taps. Shipment taps open the authenticated
tracking route; order taps open role-specific Orders. Other notices open Profile.
Sign-out clears push registration while the JWT is still available. Android has
notification permission and the backend's notification channel; iOS has push
entitlements and remote-notification background mode. Firebase Core 4.13.0 and
Messaging 16.5.0 are pinned to match the existing Auth native SDK line.

## Real service verification

Run from the backend with the existing local Fabric network running:

```sh
pnpm exec ts-node --compiler-options '{"rootDir":"."}' scripts/test/web-checkout-e2e.ts --delivery --fabric
pnpm exec ts-node --compiler-options '{"rootDir":"."}' scripts/test/web-checkout-e2e.ts --mobile --delivery --fabric
```

The fixture uses disposable MongoDB and seeded JWTs, local Safepay HTTP responses,
real notification/transport services, and the actual Fabric gateway/outbox worker.
The second fixture transporter is online near the farms when payments settle;
the first starts offline and completes both deliveries through the clients.

Verified assertions:

- Two delivered orders, two successful payments, two shipments with four status
  entries each, depleted stock and ten ledger outbox entries.
- Buyer inbox has twelve notices: two order, two payment, two assignment and six
  delivery updates. Each farmer has six notices; the competing transporter has
  two delivery offers, and the completing transporter has two assignments.
  Replayed payment callbacks do not duplicate payment/offer notifications.
- Notifications are read through the real HTTP API. A different buyer cannot
  mark a notice read; read-all clears the authenticated buyer's unread count.
- Device-token handover leaves exactly one account binding; clearing removes it.
  These are explicitly fixture tokens and are never sent to FCM.
- Ten real Fabric commits are marked confirmed with transaction hash/block number.
  An independent ledger query checks every reference ID and transaction hash;
  another worker pass is idle. The existing network/ledger is preserved and no
  chaincode upgrade or network reset is performed. Synthetic records remain in
  the local immutable ledger after the disposable database is stopped.

Normal commands without `--fabric` retain outbox-only checks. The existing local
Fabric defaults are used; `FABRIC_PEER_ENDPOINT` can override `localhost:7051`.

## Push receipt still requires runtime configuration

The supplied public Web Push certificate key is now configured locally in
`farm2fork-web/.env.local` as `NEXT_PUBLIC_FIREBASE_VAPID_KEY`. Set the same public
key in the deployment environment and rebuild when deploying. Firebase Admin credentials must be configured on the backend.
Web push requires HTTPS or localhost and a supported browser. The service worker
uses the official pinned Firebase 12.17.1 compat SDK URLs.

For iOS, enable Push Notifications for the signing App ID, provision the push
entitlement, and upload the APNs authentication key/certificate to the Firebase
project. Simulator compilation does not establish APNs/device delivery. Android
receipt requires Google Play services and notification permission.

On the signed-in test device/browser, open notification settings and enable push.
Then place/pay an order while a nearby transporter is online, accept it, and
advance pickup/transit/delivery. Check foreground display, background receipt and
notification tap, then disable/sign out and confirm subsequent pushes stop. Deny
permission and verify that the inbox still loads; retry after granting permission.
Use only controlled test accounts/orders for this check.

At this verification run, only an iOS Simulator and macOS were connected. The user confirmed no
device is available now, so real FCM/APNs
receipt and phone tap behavior are not claimed. Firebase identity acquisition and
merchant-hosted Safepay checkout remain separate checks.

## Regression results

- Web: 92 tests pass, two environment-gated skips; production build and scoped
  ESLint/TypeScript checks pass.
- Mobile: 113 tests pass, two environment-gated skips; changed source/tests pass
  static analysis, including EN/UR inbox and failed opt-in/retry widgets. Final
  Android debug APK and iOS Simulator builds pass.
- Backend: all 25 unit suites / 171 tests pass; harness ESLint and TypeScript
  checking pass. Both extended live delivery/Fabric commands pass separately.

No deployment, push to Git or chaincode lifecycle operation ran. These changes
are left for review/commit alongside the user's existing staged work.

## Supplied VAPID configuration verification

The user supplied the public VAPID key and confirmed that no device is available.
The key is stored in the ignored local web environment, validated as a 65-byte
uncompressed P-256 public key, and included in the successful production browser
build. The built messaging worker returns HTTP 200 with JavaScript content type
and root service-worker scope. This establishes configuration/build readiness,
not FCM registration or push receipt. Deployment environment setup remains needed.
