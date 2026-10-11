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
