# Backend release readiness — 2026-10-29

## Changes and canonical contract

Backend ownership covers `farm2fork-backend/src/modules/ai`, shared JWT configuration in `src/modules/auth`, and local operations AI compose/probe/documentation. Existing QR/order/traceability/transport edits were preserved; no commits, pushes, deployment, live-server or production-service calls were made.

Quality responses preserve existing fields and add required `needsReview`, nullable `reviewReason` (`low_confidence`, `unfamiliar_photo`, `photo_check_unavailable`, `unsupported_crop`, `untrained_model`) and nullable `photoSimilarity`. The backend independently suppresses `suggestedListingGrade` for missing/true review flags, missing photo similarity or missing explicit nullable reviewReason, confidence below 0.7, upstream low confidence, untrained status, unsupported/mismatched crop, or D. Raw `modelGrade` remains diagnostic. Review fields are persisted alongside the raw grade; enum-safe listing grade is omitted for reviews. Invalid upstream grades/probabilities/types/ranges fail with 503 before persistence. D may have nullable reason when no enumerated reason applies; it always requires review.

Prices now require `method: official_wholesale`, finite positive ordered min/max, the requested unit, `currency: PKR`, nonempty modelVersion/commodity/source/sourceUrl/marketScope, positive integer marketCount and valid nonfuture observedOn YYYY-MM-DD. Source URLs must be HTTP(S) without embedded credentials. Canonical output plus generated predictionId is returned; legacy or unexpected confidence/basis fields are excluded. Provenance is persisted. Farmer city comes only from `FarmerProfile.farmLocation.city`, selected without sensitive profile fields, forwarded as upstream `location`, and recorded as input location. Missing city permits the upstream province-wide reference. Upstream validation errors remain honest HTTP errors (including 422); network/config/upstream server errors map to retryable 503.

Production JWT startup now rejects absent, short (<32 characters) and known placeholder secrets in a shared helper used for signing and verification. Local development/test defaults remain compatible. No secret values were read or logged.

Operations compose now uses APP_ENV=production, mounts frozen weights at `/app/models/best_model.pth`, defaults AI_REQUIRE_TRAINED=true and requires trained health plus enabled photo checks. The authenticated offline-tested probe checks official wholesale provenance as well as positive prices. An explicit AI_REQUIRE_TRAINED=false allows degraded operation and does not prove trained quality readiness. Deployment/testing docs explain matching photo-reference fingerprints and separate weight backup/validation.

## Verification

- Red: 12 new AI contract tests failed on the former implementation; 5 new production JWT rejection tests failed before hardening.
- Final focused suite: AI and JWT tests pass (42 tests after malformed-response additions).
- Full backend Jest suite: **35 suites / 284 tests passed**, using approved local loopback access for ephemeral admin/rate-limit HTTP test servers. Initial sandbox-only run hit EPERM for those listeners; this was an environment restriction, resolved by the approved retry.
- Nest production TypeScript build passed; scoped ESLint passed for changed AI/auth TypeScript; git diff --check passed.
- Four fully mocked offline AI readiness-probe cases passed: valid trained/reference/official result; missing photo readiness; old price method; missing source. No live AI request occurred.

## Remaining release gates and proof limits

- Server is stopped by user direction. MongoDB/Redis, Firebase credentials/session delivery, Fabric identity/peer/outbox runtime, AI artifact health, payment provider settlement/webhooks and deployed health were not exercised. Unit mocks/build success do not prove those services.
- Provision a random production JWT secret (>=32 characters), explicit credentialed CORS origins, real service credentials and AI token before restart. Development .env.example deliberately contains simulator/sandbox defaults; do not deploy it unchanged.
- Mount the validated trained checkpoint separately and verify it matches the image's baked photo reference; default readiness intentionally fails otherwise. Trained/photo-enabled health does not establish genuine field accuracy.
- AMIS observations are historical wholesale references; farmers retain listing-price control. Date/source metadata must stay visible in both clients. No current-market, farm-gate, model confidence or crop-rule claim is introduced.
- End-to-end database/service/provider and signed mobile distribution acceptance remain separate from this local backend proof. No deployment receipt or production readiness assertion is made.

## Cross-service fixture smoke follow-up

Added public `src/modules/ai/fixtures/python-release-contracts.json` captured from the current Python FastAPI TestClient with the local frozen trained weights and matching reference, plus `ai.python-contract.spec.ts` exercising the actual backend service with mocked HTTP/profile/persistence. This proves the recorded blank-image diagnostic cannot become a recommendation and official Wheat wholesale provenance survives backend mapping. It does not repeat inference, access a live server, or touch a database. Fixture quality A/confidence0.6779 has unfamiliar_photo and is suppressed. The actual shipped observation remains Punjab/12 markets even when Lahore is requested; this is honest upstream fallback, not an assertion of a Lahore-specific observation.

The red smoke exposed a dropped photo-review reason and the source audit exposed the Python request key `location` mismatch; both are fixed. Valid upstream photo review reason is retained while independent unsupported/untrained safeguards remain authoritative. Added red-green checks for missing explicit reviewReason and credential-bearing source URL. Latest focused validation: **3 suites / 46 tests pass**; build and scoped lint were rerun after this follow-up. The earlier full-suite result predates these small follow-up changes.

## Final probability consistency review

Reviewer adversarial cases exposed a semantic validation hole: independently valid probability ranges could contradict the selected grade/confidence. Three new tests failed before the fix. Quality validation now requires A–D probabilities to sum to 1 within 0.001, confidence to match the selected grade probability within 0.001, and the selected grade to be a maximum (ties accepted). These checks run before persistence and return 503 on contradiction. The tolerance covers four-decimal service rounding; a sum of 0.9999 and tied maximum are explicitly accepted. A low-confidence test fixture was corrected to use internally consistent probabilities while continuing to verify the independent 0.7 suppression floor.

## Traceability e2e fixture wiring

The full e2e run exposed a stale test module: TraceabilityService now requires OrderProvenanceService, but its MongoDB-backed fixture did not register it. Fixed only `test/traceability.e2e-spec.ts` to register the real OrderProvenanceService and OrderService with real Payment/User schemas alongside existing models/dependencies. Production QR behavior is preserved. Teardown tolerates incomplete setup and always attempts module and replica-set cleanup. Scoped test-file ESLint and diff whitespace checks pass. All eight backend e2e suites passed after this correction (ephemeral local MongoDB/HTTP only); full output is `/private/tmp/f2f-backend-all-e2e-final.log`.

## Resumed final verification — 2026-11-06

Final full unit suite: **36 suites / 292 tests passed**, including the probability invariants and Python contract fixture. Nest production build passed. Durable output: `backend-unit.log` beside this report. Earlier integration receipt remains **8 suites / 49 tests passed** after real traceability fixture wiring.
