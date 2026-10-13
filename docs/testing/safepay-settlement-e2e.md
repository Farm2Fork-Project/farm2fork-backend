# Safepay settlement integration checks

Run from `farm2fork-backend` with dependencies installed:

```sh
pnpm exec jest --config test/jest-e2e.json --runInBand
```

The suite starts a disposable MongoDB replica set so settlement uses real
transactions. MongoDB binaries may be downloaded on the first run. No Safepay
credentials, merchant account, Fabric peer, or external payment requests are
required. The fixture uses an explicit test-only webhook secret and the real
`SafepayClient` HMAC verifier.

`test/payment.e2e-spec.ts` sends HTTP requests to the real payment webhook
controller and checks persisted payment, order, inventory and blockchain outbox
documents. It covers:

- Concurrent signed success callbacks and a later replay: one stock decrement,
  one paid order, one successful payment and one pending Safepay ledger record.
- Missing, invalid and tampered signatures: HTTP 403 with no persistence changes.
- Authorization-only events: acknowledged without settlement.
- Failed payments: failure recorded without consuming stock or writing an outbox
  record.
- Insufficient stock in a later order item: HTTP 400 and rollback of earlier
  stock changes, payment and order still pending.
- Unknown trackers: HTTP 404 and no changes to existing orders.
- The existing local simulator settlement/replay regression.

The health fixture tests the real `/health` HTTP route with its controller,
service and explicit version configuration. It does not boot the full production
application or exercise infrastructure startup.

Verified on 2026-10-11: all four backend E2E suites passed, 15 tests total.
The changed test files also passed ESLint and Prettier checks.

These tests exercise the implemented callback contract using synthetic signed
events. They do not validate the real Safepay event shape, hosted checkout URL,
buyer authentication, browser/mobile return handling, or a deployed Fabric
transaction. Sandbox checkout and real callbacks must still be verified before
claiming a complete buyer payment journey. The current Safepay production code
is separate pre-existing uncommitted work in this checkout.
