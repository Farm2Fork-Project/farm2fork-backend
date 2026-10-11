# Transporter delivery verification — 2026-10-11

The existing backend transport implementation is now connected to web/mobile
availability controls. A transporter loads server online/location-freshness state,
explicitly supplies current Pakistan coordinates, goes online, refreshes location,
views nearby fixed-price offers, declines or accepts, and advances the assigned
shipment through pickup, transit and delivery. Offline does not require a pin.
Offer cards show server delivery earnings, distance to pickup and estimated route
distance. Full delivery addresses appear only after acceptance. One active delivery
at a time and role/ownership validation remain server-enforced.

Coordinates are manually copied from a map app and refreshed explicitly. No GPS
acquisition, automatic foreground heartbeat, background location or default pin is
introduced. Refresh status/offers reads authoritative freshness; stale location
and offline status suppress offers and prevent acceptance in the backend.

Mobile actions handle failures and disable repeat actions while pending. Failed
updates keep the shipment available for retry. Shipment mapping now tolerates an
absent ETA and retains pickup/drop-off pins and delivery fees. Generated shipment
status serialization agrees with the backend's `picked_up`/`in_transit` values.

## Real HTTP checkout-to-delivery harness

Run from `farm2fork-backend`:

```sh
pnpm exec ts-node --compiler-options '{"rootDir":"."}' scripts/test/web-checkout-e2e.ts --delivery
pnpm exec ts-node --compiler-options '{"rootDir":"."}' scripts/test/web-checkout-e2e.ts --mobile --delivery
```

Both commands pass. The fixture starts disposable MongoDB replica-set transactions,
real Nest controllers/services and JWT/role/CSRF guards. Farm profiles initially
lack pickup locations and are updated through HTTP before quoting. Safepay tracker
and passport responses use local HTTP fixtures, followed by synthetic signed
callbacks. The actual transport service runs, including nearby matching and dispatch;
notification/push delivery is stubbed. JWT identities are seeded.

Web runs the real checkout, transporter availability/actions and buyer Orders UI.
Mobile runs real repositories and payment/shipment controllers; native availability
and failure/retry widgets are tested separately. Checks cover offline/no offers,
online/location refresh, decline scoped to one transporter, ownership rejection,
exclusive acceptance, no further offers during an active delivery, ordered status
transitions, buyer/farmer shipment reads and restored offer availability afterward.
Web also rejects invalid pins, buyer availability updates and skipped transitions,
and displays both delivered shipments in the buyer Orders view.

The final state is exactly two delivered orders, two successful payments, two
delivered shipments with four timeline entries each, depleted stock and ten
persisted ledger outbox records (two payments plus eight shipment events).
Normal harness commands without `--delivery` retain the checkout-only assertions.

## Regression checks

The web suite passes 86 tests with two environment-gated skips; TypeScript,
production build and changed transport-file ESLint pass. Mobile passes 109 tests
with two environment-gated skips, including localized availability validation and
failed pickup/retry UI coverage. Changed mobile files pass static analysis. Final
Android debug APK and iOS Simulator builds pass. Both live delivery harnesses run
separately from the skipped environment-gated tests and pass.

## Scope

Real Safepay hosted checkout/events, Firebase identity acquisition, physical-device
browser return, push delivery, GPS permissions and deployed Fabric write/readback
remain separate runtime checks. Outbox persistence does not prove ledger delivery.
No push, deployment or chaincode upgrade is performed by these tests.
