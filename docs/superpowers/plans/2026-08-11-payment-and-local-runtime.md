# Payment and Local Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the NestJS backend with local Redis and MongoDB Atlas, then complete a secure simulated payment flow from Flutter checkout through persisted order settlement.

**Architecture:** Docker Compose runs only backend and Redis; MongoDB Atlas is an external dependency configured with `DATABASE_URL`. NestJS owns payment creation and settlement inside MongoDB transactions, using one payment record and one pending blockchain outbox record per order. Flutter uses a typed payments repository and an authenticated simulator endpoint only when the simulator build flag is enabled.

**Tech Stack:** NestJS 11, Mongoose 8 with MongoDB Atlas transactions, ioredis, Docker Compose, Flutter/Dio/Riverpod, Flutter ARB localization, Jest, `mongodb-memory-server` replica sets.

## Global Constraints

- Work from `develop` or a focused `feature/...` branch; never push or work directly on `main`.
- Make a small, related commit at the end of every task; commit and branch names must not mention Codex.
- Docker Compose contains `backend` and `redis` only. MongoDB Atlas is configured exclusively with an uncommitted `DATABASE_URL`.
- Do not add gateway credentials, Atlas credentials, payment gateway references, or callback payloads to tracked files, responses, or logs.
- Payment amounts come from persisted `Order.grandTotal`; mobile must never send totals, success state, or stock changes.
- A successful payment must atomically set `PaymentStatus.Success`, set `OrderStatus.Paid`, decrement stock once, and create exactly one pending `BlockchainTransaction`.
- User-visible mobile copy is added to both `lib/l10n/app_en.arb` and `lib/l10n/app_ur.arb`, then generated with `flutter gen-l10n`.
- Update `PROGRESS.md` with completed work, commands actually run, and known verification gaps before the final commit.

---

## File Structure

### Backend runtime

- `docker-compose.yml` — runs the backend plus Redis, without a MongoDB service.
- `.env.example` — documents non-secret Atlas, Redis, JWT, and simulator settings.
- `src/app.module.ts` — validates the simulator configuration.

### Backend payments

- `src/modules/payment/payment.service.ts` — owns initiation, settlement, role-scoped reads, and refunds.
- `src/modules/payment/payment.controller.ts` — exposes buyer payment APIs and a guarded simulator API.
- `src/modules/payment/payment.module.ts` — imports order, product, and blockchain persistence dependencies.
- `src/modules/payment/dto/simulate-payment.dto.ts` — validates client-requested simulated outcome.
- `src/modules/payment/dto/index.ts` — re-exports the new DTO.
- `src/modules/payment/payment.service.spec.ts` — unit tests service business rules with mocked Mongoose models and sessions.
- `test/payment.e2e-spec.ts` — verifies transactional settlement using a replica-set test database.

### Mobile payments

- `lib/features/payments/data/models/payment.dart` — immutable client-safe payment model and status enum.
- `lib/features/payments/data/services/payments_api_service.dart` — raw Dio calls for create, read, and simulator completion.
- `lib/features/payments/data/repositories/payments_repository.dart` — typed payments interface.
- `lib/features/payments/data/repositories/api_payments_repository.dart` — maps backend DTOs to the Flutter model.
- `lib/features/payments/data/repositories/mock_payments_repository.dart` — deterministic mock-mode equivalent.
- `lib/features/payments/data/repositories/payments_repository_provider.dart` — selects mock or API implementation from `AppConfig.useMocks`.
- `lib/features/payments/presentation/providers/payment_controller.dart` — one payment attempt per created order, with partial outcome state.
- `lib/features/payments/presentation/screens/payment_screen.dart` — buyer payment status screen using existing theme tokens.
- `lib/features/cart/presentation/screens/checkout_screen.dart` — navigates successful order ids to payment.
- `lib/app/router.dart` — maps `/payments` query parameters to `PaymentScreen`.
- `lib/l10n/app_en.arb`, `lib/l10n/app_ur.arb` — complete payment-flow labels and messages.
- `test/payments/api_payments_repository_test.dart` and `test/payments/payment_controller_test.dart` — adapter and state-machine tests.

---

### Task 1: Configure the Atlas-backed backend and local Redis runtime

**Files:**
- Modify: `farm2fork-backend/docker-compose.yml`
- Create: `farm2fork-backend/.env.example`
- Modify: `farm2fork-backend/src/app.module.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`, `REDIS_URL`, and `PAYMENT_SIMULATOR_ENABLED` from Compose or `.env`.
- Produces: a backend runtime reachable on port `3000`, depending only on healthy local Redis and externally reachable Atlas.

- [ ] **Step 1: Write the Compose configuration assertion**

Run:

```bash
docker compose config > /tmp/farm2fork-compose.yaml
rg -n 'mongodb:|f2f-mongodb|mongodb_data' /tmp/farm2fork-compose.yaml
```

Expected before implementation: the command finds the existing MongoDB service and volume.

- [ ] **Step 2: Replace the Compose service definition and add safe environment documentation**

Use this Compose shape:

```yaml
services:
  backend:
    build:
      context: .
      target: development
    environment:
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}
      REDIS_URL: ${REDIS_URL:-redis://redis:6379}
    ports: ['3000:3000']
    depends_on:
      redis:
        condition: service_healthy
    volumes: ['.:/app', '/app/node_modules']
  redis:
    image: redis:8.6.3-alpine3.23
    command: redis-server --appendonly yes
    volumes: [redis_data:/data]
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
volumes:
  redis_data:
```

Add `.env.example` with `DATABASE_URL=mongodb+srv://<user>:<password>@<cluster>/farm2fork?retryWrites=true&w=majority`, `REDIS_URL=redis://redis:6379`, `JWT_SECRET=replace-with-a-long-random-secret`, and `PAYMENT_SIMULATOR_ENABLED=true`; do not create `.env`. Compose does not declare `env_file: .env`; it receives variables from the shell, an optional developer `.env`, or `--env-file`.

In `src/app.module.ts`, validate `PAYMENT_SIMULATOR_ENABLED` as a boolean defaulting to `false`.

- [ ] **Step 3: Verify the runtime configuration**

Run:

```bash
docker compose --env-file .env.example config
rg -n 'mongodb:|f2f-mongodb|mongodb_data' docker-compose.yml
```

Expected: Compose config is valid; the second command returns no matches.

- [ ] **Step 4: Commit the runtime configuration**

```bash
git add docker-compose.yml .env.example src/app.module.ts
git commit -m "chore: configure atlas backend runtime"
```

### Task 2: Persist and expose payment initiation instead of mock responses

**Files:**
- Modify: `farm2fork-backend/src/modules/payment/payment.service.ts`
- Modify: `farm2fork-backend/src/modules/payment/payment.module.ts`
- Modify: `farm2fork-backend/src/modules/payment/payment.controller.ts`
- Modify: `farm2fork-backend/src/modules/payment/dto/initiate-payment-response.dto.ts`
- Test: `farm2fork-backend/src/modules/payment/payment.service.spec.ts`

**Interfaces:**
- Consumes: `CreatePaymentDto { orderId: string; gateway: PaymentGateway }`, `Order`, `Payment`.
- Produces: `PaymentService.initiate(buyerId, dto): Promise<InitiatePaymentResponseDto>` and `PaymentService.findOne(id, user): Promise<PaymentResponseDto>`.

- [ ] **Step 1: Write failing initiation tests**

Add tests that assert the service rejects an unknown order and another buyer's order, creates a payment using `order.grandTotal`, returns an existing pending payment for the same order, and resets one failed payment to `pending` instead of inserting a duplicate. Use a fixed `orderId`, `buyerId`, and `gatewayRef` generated by a test stub.

```ts
await expect(service.initiate(otherBuyerId, { orderId, gateway })).rejects.toThrow(
  ForbiddenException,
);
expect(paymentModel.create).toHaveBeenCalledWith(
  expect.objectContaining({ orderId: expect.any(Types.ObjectId), amount: 1260 }),
);
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
pnpm exec jest src/modules/payment/payment.service.spec.ts --runInBand
```

Expected: FAIL because the service currently has no injected models or persistence behavior.

- [ ] **Step 3: Implement minimal persisted initiation and reads**

Import `OrderModule` in `PaymentModule`. In `PaymentService`, inject `Payment` and `Order` models. Implement the following contract:

```ts
async initiate(buyerId: string, dto: CreatePaymentDto): Promise<InitiatePaymentResponseDto> {
  const order = await this.orderModel.findById(dto.orderId).exec();
  if (!order) throw new NotFoundException('Order not found');
  if (order.buyerId.toHexString() !== buyerId) {
    throw new ForbiddenException('You can only pay for your own order');
  }
  if (order.status !== OrderStatus.Pending) {
    throw new BadRequestException('Only pending orders can be paid');
  }
  // Reuse an existing pending record; reset a failed record instead of creating a duplicate.
}
```

Persist a unique `gatewayRef` with `crypto.randomUUID()`, but return only `payment` from `InitiatePaymentResponseDto`; remove mock `redirectUrl` and `clientSecret` fields and their Swagger descriptions. Convert documents with one `toResponse` method that omits `gatewayRef`.

- [ ] **Step 4: Run focused and existing payment/order tests**

Run:

```bash
pnpm exec jest src/modules/payment/payment.service.spec.ts src/modules/order/order.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit the initiation slice**

```bash
git add src/modules/payment
git commit -m "feat: persist payment initiation"
```

### Task 3: Settle simulated payments atomically and create a blockchain outbox record

**Files:**
- Create: `farm2fork-backend/src/modules/payment/dto/simulate-payment.dto.ts`
- Modify: `farm2fork-backend/src/modules/payment/dto/index.ts`
- Modify: `farm2fork-backend/src/modules/payment/payment.controller.ts`
- Modify: `farm2fork-backend/src/modules/payment/payment.module.ts`
- Modify: `farm2fork-backend/src/modules/payment/payment.service.ts`
- Modify: `farm2fork-backend/package.json`
- Modify: `farm2fork-backend/pnpm-lock.yaml`
- Test: `farm2fork-backend/src/modules/payment/payment.service.spec.ts`
- Test: `farm2fork-backend/test/payment.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST /payments/:id/simulate` with JWT buyer and `SimulatePaymentDto { status: PaymentStatus.Success | PaymentStatus.Failed }`.
- Produces: `PaymentService.simulate(id, buyerId, status): Promise<PaymentResponseDto>`.

- [ ] **Step 1: Write failing settlement tests**

Add unit tests for success, failed, unauthorized, and replayed settlement. Assert a successful settlement performs conditional stock changes and records exactly one pending blockchain record.

```ts
expect(productModel.updateOne).toHaveBeenCalledWith(
  { _id: item.productId, quantity: { $gte: item.quantity } },
  { $inc: { quantity: -item.quantity } },
  { session },
);
expect(blockchainModel.create).toHaveBeenCalledWith(
  [expect.objectContaining({ type: BlockchainTxType.Payment, status: BlockchainTxStatus.Pending })],
  { session },
);
```

Create an integration test backed by `MongoMemoryReplSet` that creates one pending order, one product with sufficient stock, and one payment. Call the service twice with `PaymentStatus.Success`; assert stock decreased once, order is `paid`, payment is `success`, and exactly one blockchain transaction exists.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run:

```bash
pnpm exec jest src/modules/payment/payment.service.spec.ts --runInBand
```

Expected: FAIL because settlement and the simulator endpoint do not exist.

- [ ] **Step 3: Implement guarded simulator settlement**

Add `SimulatePaymentDto` using `@IsEnum([PaymentStatus.Success, PaymentStatus.Failed])`. Add `POST /payments/:id/simulate` guarded by `@Roles(UserRole.Buyer)`. Reject it with `NotFoundException` unless `PAYMENT_SIMULATOR_ENABLED=true` and `NODE_ENV !== 'production'`.

Inject `Connection`, `Product`, and `BlockchainTransaction` models by importing `MarketplaceModule` and `BlockchainModule` into `PaymentModule`. Implement settlement within `connection.startSession().withTransaction(...)`:

```ts
const payment = await this.paymentModel.findOne({ _id: id, buyerId }).session(session).exec();
if (!payment) throw new NotFoundException('Payment not found');
if (payment.status === PaymentStatus.Success) return this.toResponse(payment);
if (payment.status !== PaymentStatus.Pending) throw new BadRequestException('Payment cannot be settled');
if (status === PaymentStatus.Failed) {
  payment.status = PaymentStatus.Failed;
  payment.failedAt = new Date();
  await payment.save({ session });
  return this.toResponse(payment);
}
```

For success, load the pending order in the same session, apply one conditional `updateOne` per order item, fail the transaction when any `modifiedCount !== 1`, then create the typed payment payload and assign its id to `payment.blockchainTxId`. Set the order to `paid`, set `payment.paidAt`, and save both in the same session. If a product reaches quantity zero, update its status to `sold_out` in the same transaction.

Keep `POST /payments/webhook/:gateway` public but make it return `NotImplementedException` until real provider signature verification is designed. Do not use a public fake webhook to settle payments.

- [ ] **Step 4: Install the replica-set test dependency and run all settlement tests**

Run:

```bash
pnpm add -D mongodb-memory-server
pnpm exec jest src/modules/payment/payment.service.spec.ts --runInBand
pnpm test:e2e -- payment.e2e-spec.ts --runInBand
```

Expected: all payment tests PASS; the e2e test proves transaction and callback replay behavior.

- [ ] **Step 5: Commit transactional settlement**

```bash
git add package.json pnpm-lock.yaml src/modules/payment test/payment.e2e-spec.ts
git commit -m "feat: settle simulated payments atomically"
```

### Task 4: Add the typed mobile payment data layer

**Files:**
- Create: `farm2fork-mobile/lib/features/payments/data/models/payment.dart`
- Create: `farm2fork-mobile/lib/features/payments/data/services/payments_api_service.dart`
- Create: `farm2fork-mobile/lib/features/payments/data/repositories/payments_repository.dart`
- Create: `farm2fork-mobile/lib/features/payments/data/repositories/api_payments_repository.dart`
- Create: `farm2fork-mobile/lib/features/payments/data/repositories/mock_payments_repository.dart`
- Create: `farm2fork-mobile/lib/features/payments/data/repositories/payments_repository_provider.dart`
- Test: `farm2fork-mobile/test/payments/api_payments_repository_test.dart`

**Interfaces:**
- Consumes: backend payment DTOs with `id`, `orderId`, `amount`, `currency`, `gateway`, `status`, and timestamps.
- Produces: `PaymentsRepository.initiate(orderId)`, `simulate(paymentId, status)`, and `getPayment(paymentId)`.

- [ ] **Step 1: Write failing API adapter tests**

Test that JSON maps status strings to `PaymentStatus.pending`, `success`, and `failed`, and that the adapter sends only `orderId` plus `gateway: jazzcash` when starting a payment.

```dart
expect(payment.status, PaymentStatus.success);
expect(request.data, {'orderId': 'order-1', 'gateway': 'jazzcash'});
expect(request.data.containsKey('amount'), isFalse);
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
flutter test test/payments/api_payments_repository_test.dart
```

Expected: FAIL because the payments library does not exist.

- [ ] **Step 3: Implement the model, API adapter, and mock repository**

Use the client-safe model shape:

```dart
enum PaymentStatus { pending, success, failed, refunded }

class Payment {
  const Payment({required this.id, required this.orderId, required this.amount,
    required this.currency, required this.status, required this.createdAt});
  final String id;
  final String orderId;
  final double amount;
  final String currency;
  final PaymentStatus status;
  final DateTime createdAt;
}
```

`PaymentsApiService` must call `POST /payments`, `GET /payments/:id`, and `POST /payments/:id/simulate`; it returns raw decoded maps exactly like `OrdersApiService`. The API repository maps status defensively, throwing `ApiException` on missing required ids. The mock repository returns a pending payment and settles only through `simulate`, so mock and API flows share the same controller contract.

- [ ] **Step 4: Run focused tests and static analysis**

Run:

```bash
flutter test test/payments/api_payments_repository_test.dart
flutter analyze
```

Expected: PASS with no analyzer errors from the new data layer.

- [ ] **Step 5: Commit the mobile data layer**

```bash
git add lib/features/payments test/payments/api_payments_repository_test.dart
git commit -m "feat: add mobile payment data layer"
```

### Task 5: Add the mobile payment flow after farmer-grouped checkout

**Files:**
- Create: `farm2fork-mobile/lib/features/payments/presentation/providers/payment_controller.dart`
- Create: `farm2fork-mobile/lib/features/payments/presentation/screens/payment_screen.dart`
- Modify: `farm2fork-mobile/lib/features/cart/presentation/screens/checkout_screen.dart`
- Modify: `farm2fork-mobile/lib/app/router.dart`
- Modify: `farm2fork-mobile/lib/l10n/app_en.arb`
- Modify: `farm2fork-mobile/lib/l10n/app_ur.arb`
- Modify: `farm2fork-mobile/lib/core/localization/generated/app_localizations.dart`
- Modify: `farm2fork-mobile/lib/core/localization/generated/app_localizations_en.dart`
- Modify: `farm2fork-mobile/lib/core/localization/generated/app_localizations_ur.dart`
- Test: `farm2fork-mobile/test/payments/payment_controller_test.dart`

**Interfaces:**
- Consumes: `PaymentsRepository` from Task 4 and successful `CheckoutResult.placed` orders.
- Produces: `/payments?orderId=<id>&orderId=<id>` and `PaymentController.pay(orderIds)`.

- [ ] **Step 1: Write failing controller tests**

Create a recording `PaymentsRepository` that succeeds for `order-a` and fails for `order-b`. Assert the controller starts one payment per order and reports partial settlement without losing the successful result.

```dart
final result = await container.read(paymentControllerProvider.notifier)
    .pay(const ['order-a', 'order-b']);
expect(result.successfulOrderIds, ['order-a']);
expect(result.failedOrderIds, ['order-b']);
```

- [ ] **Step 2: Run the controller test and confirm failure**

Run:

```bash
flutter test test/payments/payment_controller_test.dart
```

Expected: FAIL because `PaymentController` does not exist.

- [ ] **Step 3: Implement controller, route, localized screen, and checkout navigation**

Define `PaymentFlowResult` with `successfulOrderIds` and `failedOrderIds`. For every order id, call `initiate(orderId)` then `simulate(payment.id, PaymentStatus.success)` only when `AppConfig.useMocks` or a new compile-time `PAYMENT_SIMULATOR_ENABLED` flag is true. In a non-simulator API build, display the pending state and poll `getPayment` instead of calling simulation.

After every successful checkout order, build the route with `Uri` so multiple ids are encoded safely:

```dart
final location = Uri(
  path: '/payments',
  queryParameters: {'orderId': result.placed.map((order) => order.id).toList()},
).toString();
if (context.mounted) context.go(location);
```

Add a buyer-only `/payments` route that reads `state.uri.queryParametersAll['orderId']`. `PaymentScreen` uses `AppCard`, `AppButton`, `AppColors`, `AppSpacing`, and `AppTextStyles` only. Add English and Urdu strings for payment pending, success, failure, retry, and order counts; run `flutter gen-l10n` instead of hand-editing generated localization files.

- [ ] **Step 4: Run mobile verification**

Run:

```bash
flutter gen-l10n
flutter test test/payments/payment_controller_test.dart test/orders/checkout_controller_test.dart
flutter analyze
```

Expected: PASS. Checkout tests still prove one order per farmer group, and payment tests prove one payment attempt per created order.

- [ ] **Step 5: Commit the mobile payment flow**

```bash
git add lib/app/router.dart lib/features/cart/presentation/screens/checkout_screen.dart lib/features/payments lib/l10n test/payments
git commit -m "feat: add simulated mobile payment flow"
```

### Task 6: Verify the complete slice and record its actual state

**Files:**
- Modify: `farm2fork-mobile/PROGRESS.md`

**Interfaces:**
- Consumes: completed Tasks 1–5 and their actual command results.
- Produces: an auditable tracker entry separating automated verification from unavailable Atlas/device checks.

- [ ] **Step 1: Run backend checks**

Run:

```bash
docker compose --env-file .env.example config
pnpm run build
pnpm test
pnpm test:e2e --runInBand
```

Expected: all commands PASS. If Atlas credentials are unavailable, do not run `docker compose up`; record that manual Atlas smoke verification remains open.

- [ ] **Step 2: Run mobile checks**

Run:

```bash
flutter analyze
flutter test
```

Expected: PASS.

- [ ] **Step 3: Perform the manual integration smoke test when Atlas credentials are available**

Run:

```bash
cp .env.example .env
docker compose up --build
```

With a buyer account and a pending order, initiate one payment, settle it through the authenticated simulator, then confirm in Atlas that the payment and order are successful/paid, stock decreased once, and one pending blockchain transaction exists. Stop the stack with `docker compose down`; never commit `.env`.

- [ ] **Step 4: Update the tracker with evidence**

Change Slice 3 in `PROGRESS.md` from “not started” to “completed” only when all implemented work and automated checks pass. Include the exact test commands, commit hashes, the absence or presence of a manual Atlas smoke test, and the deferred real-gateway/Fabric items.

- [ ] **Step 5: Commit the verification record**

```bash
git add PROGRESS.md
git commit -m "docs: record payment slice verification"
```

## Plan Self-Review

- Spec coverage: Task 1 implements Atlas plus Redis runtime; Tasks 2–3 implement persisted, idempotent, atomic payment settlement and the blockchain outbox; Tasks 4–5 implement the mobile payment flow; Task 6 records verification and remaining gaps.
- Placeholder scan: no deferred action is left undefined; real gateways, Fabric Gateway integration, web integration, and refund restocking are explicitly excluded from this slice.
- Type consistency: backend settlement uses `PaymentStatus`, `OrderStatus`, and `BlockchainTxStatus` from existing schemas; mobile maps the same client-safe status values through `PaymentStatus` and never carries gateway references.
