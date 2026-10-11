# Backend rebase verification — 2026-10-11

The rebase onto `9110dae` is complete. Safepay's mobile return marker and the
new notification/transport dispatch implementation were combined. The resolved
payment HTTP fixture retains both the real Safepay provider and the new
notification/transport mocks. Its dispatch mock resets before each test.

A malformed loan-filter block was already present in `9110dae`; it was repaired
without dropping enum validation or the explicit `$eq` query. Production builds
now exclude development `scripts` outside their `src` root. Those harnesses
continue to run separately through ts-node with `rootDir: .`.

Verified on the merged backend:

- Full unit suite: 25 suites, 171 tests passed (29 payment tests included).
- HTTP/MongoDB integration suite: five suites, 20 tests passed.
- `pnpm run build`: passed.
- `pnpm exec tsc -p tsconfig.build.json --noEmit --rootDir .`: passed.
- Changed checkout harness and mobile return fixture ESLint: passed.
- No unresolved merge entries or conflict markers remain.

## Client integration regression

Both real web and mobile checkout harnesses were rerun and FAILED. The new
`CreateOrderDto` requires `shippingAddress.lat` and `shippingAddress.lng` inside
Pakistan. The committed clients still submit only the text address, so Nest
rejects checkout with HTTP 400 before payment initiation. This is a real
contract mismatch; earlier passing checkout results applied to the previous
backend and must not be reported as passing on this revision.

The newer order service also requires a farmer pickup location and adds
server-calculated delivery fees. The next checkout increment must capture and
submit an explicit buyer location on both clients, support farmer pickup
configuration, update order/quote DTOs and price displays, and update fixture
profiles, addresses and gateway amount assertions to cover the full total.
Do not add fabricated coordinates or disable validation to make tests pass.

Real Safepay merchant/browser flows, Firebase acquisition and deployed Fabric
remain outside this local verification. No push or deployment was performed.

## Delivery contract repair — 2026-10-11

The regression above is now repaired in the working clients. Buyers explicitly
enter Pakistan delivery coordinates and review `POST /orders/quote` for every
farmer group before order creation. Quotes include the authoritative item price,
platform fee, delivery fee, estimated distance and total. Address/cart changes
invalidate the quote. No default or fabricated coordinates are sent.

Farmers can load and save a complete pickup address/pin through
`GET/PATCH /farmers/me/farm-location` from Listings on web/mobile. Signup defers
pickup setup to this form rather than submitting a rejected address-only object.
The fixture starts with incomplete farm profiles and configures them through the
real API; its gateway assertions use each persisted order total including delivery.

Both checkout harnesses PASS on the current backend: web React checkout and
Orders UI, and mobile Dart repositories/controller. They cover real Nest HTTP,
JWT/role guards, MongoDB transactions, delivery quotes, Safepay initiation and
resume, signed callback settlement/replay, stock depletion, exactly two paid
orders, two payments and two ledger outbox records. Web also verifies incomplete
pickup rejection, invalid coordinates, buyer rejection from pickup PATCH and
that quoting creates no orders. Mobile widgets separately cover invalid pins,
quote invalidation and pickup loading/saving. Safepay responses are local HTTP
fixtures; notification/transport dispatch are stubbed. Seeded JWTs do not prove
Firebase sign-in. Outbox writes do not prove delivery to deployed Fabric.

## Transport client completion — 2026-10-11

Web/mobile now support transporter online/offline, explicit current-coordinate
updates, priced nearby offers, decline and delivery transitions. Both real HTTP
checkout-to-delivery harnesses pass using the actual transport service rather than
a dispatch stub. The mobile adapter's required-ETA mismatch was repaired. See
`docs/testing/transporter-delivery.md` for commands, assertions and runtime limits.
