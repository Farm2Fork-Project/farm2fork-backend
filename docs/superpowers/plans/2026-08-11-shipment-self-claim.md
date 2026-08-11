# Shipment Self-Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let transporters discover and atomically self-claim paid orders, update delivery status, and expose a role-scoped shipment timeline to transporters, buyers, and farmers.

**Architecture:** A delivery is an eligible paid order without `shipmentId`; it is not a placeholder Shipment. A Mongo transaction claims the order, creates the assigned Shipment, updates the Order, and appends a typed supply-chain blockchain outbox record. Flutter uses the existing Dio/Riverpod repository pattern for a transporter available/my-deliveries view and a read-only tracking route.

**Tech Stack:** NestJS 11, Mongoose 8 transactions, MongoDB replica-set tests, Flutter/Dio/Riverpod/Freezed, ARB localization, Jest, Flutter test.

## Global Constraints

- Work only on local `feature/shipment-self-claim` branches based on the local payment branches; do not push or work on `main`.
- Keep commits small and related; branch and commit names must not mention Codex.
- A delivery is claimable only when its order is `paid`, has no `shipmentId`, and its farmer profile has non-empty `farmLocation.address`, `farmLocation.city`, and `farmLocation.province`.
- No placeholder Shipment is created before claim. The first persisted shipment status is `assigned`.
- The first claim wins: a repeated/concurrent claim returns HTTP 409 and cannot alter the assigned transporter.
- Only the assigned transporter can advance `assigned → picked_up → in_transit → delivered` or set `failed` from a non-terminal state.
- Claim and every status change create exactly one pending typed supply-chain blockchain outbox record; Fabric submission/retry remains out of scope.
- Do not add transport fees, bids, buyer selection, notifications, maps/GPS, proof-of-delivery, reassignment, or refund restocking.
- Add all user-visible shipment copy to both `lib/l10n/app_en.arb` and `lib/l10n/app_ur.arb`, then run `flutter gen-l10n`; do not hand-edit generated localization output.
- Update `PROGRESS.md` only with commands actually run and confirmed results. The user owns Atlas/device smoke testing for this slice.

---

## File Structure

### Backend transport domain

- `src/modules/transport/transport.service.ts` — availability, claim transaction, role-scoped reads, and guarded transitions.
- `src/modules/transport/transport.controller.ts` — authenticated shipment API with transporter and reader role boundaries.
- `src/modules/transport/transport.module.ts` — registers Shipment plus imports Order/Auth/Blockchain persistence dependencies.
- `src/modules/transport/dto/claim-shipment.dto.ts` — validated `orderId` claim input.
- `src/modules/transport/dto/update-shipment-status.dto.ts` — validated next status and bounded note.
- `src/modules/transport/dto/shipment-response.dto.ts` — client-safe Shipment, history, and available-delivery DTOs.
- `src/modules/transport/dto/index.ts` — DTO exports.
- `src/modules/transport/transport.service.spec.ts` — unit coverage for eligibility, ownership, transitions, and outbox writes.
- `test/shipment.e2e-spec.ts` — Mongo replica-set concurrent-claim proof.

### Mobile shipment data and UI

- `lib/features/shipments/data/models/available_delivery.dart` — typed redacted delivery-offer model.
- `lib/features/shipments/data/services/shipments_api_service.dart` — raw `/shipments` calls.
- `lib/features/shipments/data/repositories/api_shipments_repository.dart` — DTO mapping and defensive validation.
- `lib/features/shipments/data/repositories/shipments_repository.dart` — typed available/my/read/claim/update contract.
- `lib/features/shipments/data/repositories/mock_shipments_repository.dart` — stateful equivalent for mock mode.
- `lib/features/shipments/presentation/providers/shipments_controller.dart` — auth-aware available/my/status state.
- `lib/features/shipments/presentation/screens/shipments_screen.dart` — transporter available/my list and claim/status controls.
- `lib/features/shipments/presentation/screens/shipment_tracking_screen.dart` — buyer/farmer read-only timeline.
- `lib/features/orders/presentation/screens/orders_screen.dart` and `lib/app/router.dart` — tracking entry point and protected route.
- `test/shipments/api_shipments_repository_test.dart`, `test/shipments/shipments_controller_test.dart`, and `test/shipments/shipment_tracking_screen_test.dart` — client contract and role/UI coverage.

### Tracker

- `farm2fork-mobile/PROGRESS.md` — records commits, verified commands, and Atlas/device limitations.

---

### Task 1: Implement server-side availability and atomic self-claim

**Files:**
- Create: `src/modules/transport/dto/claim-shipment.dto.ts`
- Create: `src/modules/transport/dto/shipment-response.dto.ts`
- Create: `src/modules/transport/dto/index.ts`
- Create: `src/modules/transport/transport.service.ts`
- Create: `src/modules/transport/transport.service.spec.ts`
- Modify: `src/modules/transport/transport.module.ts`

**Interfaces:**
- Consumes: `Order` with `status`, `shipmentId`, `shippingAddress`, `farmerId`; `FarmerProfile.farmLocation`; `Shipment`; `BlockchainTransaction`.
- Produces: `TransportService.findAvailable(): Promise<AvailableDeliveryResponseDto[]>` and `TransportService.claim(orderId: string, transporterId: string): Promise<ShipmentResponseDto>`.

- [ ] **Step 1: Write failing availability and claim tests**

```ts
it('lists only paid, unclaimed orders with complete farm locations', async () => {
  orderModel.find.mockReturnValue(query([paidUnclaimedOrder, unpaidOrder]));
  farmerProfileModel.find.mockReturnValue(query([completeFarmProfile]));

  const deliveries = await service.findAvailable();

  expect(deliveries).toEqual([
    expect.objectContaining({ orderId: paidUnclaimedOrder.id, itemCount: 2 }),
  ]);
});

it('claims a paid order once and creates a shipment plus outbox record', async () => {
  orderModel.findOneAndUpdate.mockReturnValue(transactionQuery(paidOrder));
  farmerProfileModel.findOne.mockReturnValue(transactionQuery(completeFarmProfile));
  shipmentModel.create.mockResolvedValue([assignedShipment]);

  await service.claim(orderId, transporterId);

  expect(assignedShipment.statusHistory).toEqual([
    expect.objectContaining({ status: ShipmentStatus.Assigned }),
  ]);
  expect(blockchainModel.create).toHaveBeenCalledWith(
    [expect.objectContaining({
      type: BlockchainTxType.SupplyChainEvent,
      referenceModel: BlockchainReferenceModel.Shipment,
      status: BlockchainTxStatus.Pending,
    })],
    { session },
  );
});
```

- [ ] **Step 2: Run the focused unit test and confirm it fails**

Run: `pnpm exec jest src/modules/transport/transport.service.spec.ts --runInBand`

Expected: FAIL because TransportService and transport DTOs do not exist.

- [ ] **Step 3: Implement DTOs and client-safe response mapping**

```ts
export class ClaimShipmentDto {
  @IsMongoId()
  orderId!: string;
}

export class AvailableDeliveryResponseDto {
  orderId!: string;
  pickupCity!: string;
  pickupProvince!: string;
  deliveryCity!: string;
  deliveryProvince!: string;
  itemCount!: number;
  createdAt!: string;
}
```

Create `ShipmentResponseDto` with `id`, `orderId`, `transporterId`, `status`,
full pickup/delivery addresses, status history, estimated/actual delivery, and
timestamps. Keep buyer phone/email and any sensitive profile data out of every
DTO.

- [ ] **Step 4: Implement availability and claim in one transaction**

```ts
const order = await this.orderModel.findOneAndUpdate(
  { _id: orderId, status: OrderStatus.Paid, shipmentId: { $exists: false } },
  { $set: { status: OrderStatus.Processing } },
  { new: true, session },
).exec();
if (!order) throw new ConflictException('Delivery is no longer available');

const shipment = await this.shipmentModel.create([{
  orderId: order._id,
  transporterId: new Types.ObjectId(transporterId),
  status: ShipmentStatus.Assigned,
  pickupAddress: farmAddress,
  deliveryAddress: order.shippingAddress,
  estimatedDelivery: new Date(Date.now() + 48 * 60 * 60 * 1000),
  statusHistory: [{
    status: ShipmentStatus.Assigned,
    timestamp: new Date(),
    note: 'Shipment claimed by transporter',
    updatedBy: new Types.ObjectId(transporterId),
  }],
}], { session });
order.shipmentId = shipment[0]._id;
await order.save({ session });
```

Validate the farm location before the conditional order update. Convert a
duplicate-shipment key error to `ConflictException`. Create the typed
`SupplyChainEvent` outbox record in the same transaction with
`eventType: 'shipment_assigned'`, `referenceModel: Shipment`, the order farmer
id, and transporter actor details.

- [ ] **Step 5: Run focused tests and commit the backend claim slice**

Run: `pnpm exec jest src/modules/transport/transport.service.spec.ts --runInBand`

Expected: PASS.

```bash
git add src/modules/transport
git commit -m "feat: add shipment self-claim"
```

### Task 2: Add role-scoped shipment reads and guarded status transitions

**Files:**
- Create: `src/modules/transport/dto/update-shipment-status.dto.ts`
- Modify: `src/modules/transport/dto/index.ts`
- Modify: `src/modules/transport/transport.service.ts`
- Modify: `src/modules/transport/transport.service.spec.ts`
- Create: `src/modules/transport/transport.controller.ts`
- Modify: `src/modules/transport/transport.module.ts`

**Interfaces:**
- Consumes: `RequestUser`, `ShipmentStatus`, and an assigned Shipment.
- Produces: `GET /shipments/available`, `GET /shipments`, `GET /shipments/:id`, `POST /shipments/claims`, and `PATCH /shipments/:id/status`.

- [ ] **Step 1: Write failing read/transition tests**

```ts
await expect(
  service.updateStatus(shipmentId, otherTransporterId, {
    status: ShipmentStatus.PickedUp,
    note: 'Collected produce',
  }),
).rejects.toBeInstanceOf(ForbiddenException);

await expect(
  service.updateStatus(shipmentId, transporterId, {
    status: ShipmentStatus.Delivered,
    note: 'Skipped states',
  }),
).rejects.toBeInstanceOf(BadRequestException);
```

Also cover buyer and farmer reads through their own order ids, transporter
reads through `transporterId`, delivery setting `actualDelivery`, and an
outbox record for every accepted transition.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm exec jest src/modules/transport/transport.service.spec.ts --runInBand`

Expected: FAIL because status transition and reader scope methods do not exist.

- [ ] **Step 3: Implement the DTO, transition table, and service methods**

```ts
const NEXT: Record<ShipmentStatus, ShipmentStatus[]> = {
  [ShipmentStatus.Assigned]: [ShipmentStatus.PickedUp, ShipmentStatus.Failed],
  [ShipmentStatus.PickedUp]: [ShipmentStatus.InTransit, ShipmentStatus.Failed],
  [ShipmentStatus.InTransit]: [ShipmentStatus.Delivered, ShipmentStatus.Failed],
  [ShipmentStatus.Delivered]: [],
  [ShipmentStatus.Failed]: [],
};
```

`UpdateShipmentStatusDto` must use `@IsEnum(ShipmentStatus)`, `@IsString()`,
and `@MaxLength(500)` on `note`. For accepted updates, append server time and
the authenticated transporter ObjectId, map `picked_up`/`in_transit` to
`OrderStatus.Shipped`, map `delivered` to `OrderStatus.Delivered` plus
`actualDelivery`, and leave the order's current status unchanged on `failed`.
Write the corresponding pending supply-chain outbox record in the same
transaction.

- [ ] **Step 4: Add API controller and dependency imports**

```ts
@Get('available')
@Roles(UserRole.Transporter)
findAvailable(): Promise<AvailableDeliveryResponseDto[]> { ... }

@Post('claims')
@Roles(UserRole.Transporter)
claim(@CurrentUser() user: RequestUser, @Body() dto: ClaimShipmentDto) { ... }

@Patch(':id/status')
@Roles(UserRole.Transporter)
updateStatus(@CurrentUser() user: RequestUser, @Param('id') id: string,
  @Body() dto: UpdateShipmentStatusDto) { ... }
```

Put `available` and `claims` before `:id`. `GET /shipments` and
`GET /shipments/:id` allow buyer, farmer, transporter, and admin, with the
service enforcing role scope. Import `OrderModule`, `AuthModule`, and
`BlockchainModule` into `TransportModule`.

- [ ] **Step 5: Run backend tests/build and commit**

Run:

```bash
pnpm exec jest src/modules/transport/transport.service.spec.ts --runInBand
pnpm run build
pnpm test
```

Expected: all pass; remove only the build-generated `tsconfig.build.tsbuildinfo`
diff before committing if it is the sole generated change.

```bash
git add src/modules/transport
git commit -m "feat: track shipment delivery status"
```

### Task 3: Prove first-claim concurrency with a Mongo replica set

**Files:**
- Create: `test/shipment.e2e-spec.ts`
- Modify: `package.json` and `pnpm-lock.yaml` only if the existing `mongodb-memory-server` dependency cannot support this test.

**Interfaces:**
- Consumes: the real `TransportService`, Shipment/Order/FarmerProfile/Blockchain Mongoose models, and `MongoMemoryReplSet` already introduced by the payment slice.
- Produces: an integration proof that one order cannot become two shipments.

- [ ] **Step 1: Write the failing concurrent-claim integration test**

```ts
const [first, second] = await Promise.allSettled([
  service.claim(order.id, transporterA.toHexString()),
  service.claim(order.id, transporterB.toHexString()),
]);

expect([first, second].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
expect(await shipmentModel.countDocuments({ orderId: order._id })).toBe(1);
expect(await blockchainModel.countDocuments({
  type: BlockchainTxType.SupplyChainEvent,
})).toBe(1);
```

- [ ] **Step 2: Run the e2e test and confirm it fails**

Run: `pnpm test:e2e -- shipment.e2e-spec.ts --runInBand`

Expected: FAIL until the transaction and 409 handling are complete.

- [ ] **Step 3: Complete the minimal implementation needed by the real test**

Do not add retry loops in client code. Rely on `session.withTransaction`, the
conditional paid/unclaimed order update, and the unique `Shipment.orderId`
index. Translate duplicate-key errors at the service boundary to HTTP 409.

- [ ] **Step 4: Run the complete backend verification and commit**

Run:

```bash
pnpm run build
pnpm test
pnpm test:e2e --runInBand
```

Expected: build, all unit tests, and all e2e tests pass.

```bash
git add test/shipment.e2e-spec.ts package.json pnpm-lock.yaml
git commit -m "test: verify concurrent shipment claims"
```

### Task 4: Add the typed mobile shipment API and mock contract

**Files:**
- Create: `lib/features/shipments/data/models/available_delivery.dart`
- Create: `lib/features/shipments/data/services/shipments_api_service.dart`
- Create: `lib/features/shipments/data/repositories/api_shipments_repository.dart`
- Modify: `lib/features/shipments/data/repositories/shipments_repository.dart`
- Modify: `lib/features/shipments/data/repositories/mock_shipments_repository.dart`
- Create: `test/shipments/api_shipments_repository_test.dart`

**Interfaces:**
- Consumes: `/shipments/available`, `/shipments`, `/shipments/:id`, `/shipments/claims`, and `/shipments/:id/status` envelopes from Tasks 1–2.
- Produces: `getAvailable()`, `getMine()`, `getById(id)`, `claim(orderId)`, and `updateStatus(shipmentId, status, note)` on `ShipmentsRepository`.

- [ ] **Step 1: Write failing adapter tests**

```dart
final delivery = await ApiShipmentsRepository(api).getAvailable();

expect(delivery.single.orderId, 'order-1');
expect(api.lastPath, '/shipments/available');

await ApiShipmentsRepository(api).claim('order-1');
expect(api.lastRequestBody, {'orderId': 'order-1'});
```

Use a complete server DTO fixture. Assert malformed/missing shipment ids raise
`ApiException` and that no client supplies `transporterId`, addresses, order
state, timestamps, or blockchain information during claim/status updates.

- [ ] **Step 2: Run the adapter test and confirm it fails**

Run: `flutter test test/shipments/api_shipments_repository_test.dart`

Expected: FAIL because the real shipment API adapter does not exist.

- [ ] **Step 3: Implement the data layer and stateful mock equivalent**

```dart
abstract class ShipmentsRepository {
  Future<List<AvailableDelivery>> getAvailable();
  Future<List<Shipment>> getMine();
  Future<Shipment> getById(String shipmentId);
  Future<Shipment> claim(String orderId);
  Future<Shipment> updateStatus({
    required String shipmentId,
    required ShipmentStatus status,
    required String note,
  });
}
```

`ShipmentsApiService` sends only `{orderId}` to `POST /shipments/claims` and
only `{status, note}` to status PATCH. Move the current mock-only provider to
select `MockShipmentsRepository` for `AppConfig.useMocks`, otherwise return
`ApiShipmentsRepository(ShipmentsApiService(ref.watch(dioProvider)))`.

- [ ] **Step 4: Verify the data layer and commit**

Run:

```bash
flutter test test/shipments/api_shipments_repository_test.dart
flutter analyze
```

Expected: PASS with no analyzer issues.

```bash
git add lib/features/shipments/data test/shipments/api_shipments_repository_test.dart
git commit -m "feat: add shipment self-claim data layer"
```

### Task 5: Wire transporter self-claim and read-only tracking UI

**Files:**
- Modify: `lib/features/shipments/presentation/providers/shipments_controller.dart`
- Modify: `lib/features/shipments/presentation/screens/shipments_screen.dart`
- Create: `lib/features/shipments/presentation/screens/shipment_tracking_screen.dart`
- Modify: `lib/features/orders/presentation/screens/orders_screen.dart`
- Modify: `lib/app/router.dart`
- Modify: `lib/app/navigation/app_nav_config.dart`
- Modify: `lib/l10n/app_en.arb`
- Modify: `lib/l10n/app_ur.arb`
- Create: `test/shipments/shipments_controller_test.dart`
- Create: `test/shipments/shipment_tracking_screen_test.dart`

**Interfaces:**
- Consumes: Task 4 repository methods and the authenticated `AppUserRole`.
- Produces: transporter available/my-deliveries controls plus `/shipments/:id` tracking for shipment-owning buyer/farmer orders.

- [ ] **Step 1: Write failing controller and widget tests**

```dart
final result = await container
    .read(shipmentsControllerProvider.notifier)
    .claim('order-1');

expect(result.status, ShipmentStatus.assigned);
expect(repository.claimedOrderIds, ['order-1']);
```

For the tracker widget, provide a buyer/farmer role and a delivered shipment;
assert the status history is rendered and neither claim nor update controls are
present. For the transporter widget, assert the available delivery card exposes
the localized claim action but not the street addresses before claim.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run:

```bash
flutter test test/shipments/shipments_controller_test.dart
flutter test test/shipments/shipment_tracking_screen_test.dart
```

Expected: FAIL because the controller has no self-claim state and the tracking
screen/route do not exist.

- [ ] **Step 3: Implement controller and route boundaries**

Add controller methods `fetchAvailable()`, `fetchMine()`, `claim(orderId)`,
and `updateStatus(...)`, preserving partial state rather than importing an
email as `updatedBy`. Add a protected `/shipments/:id` route for buyer, farmer,
and transporter. Add a buyer/farmer order-card tracking action only when
`order.shipmentId != null`; the tracking screen calls `getById` and never
renders mutation actions.

- [ ] **Step 4: Implement localized transporter and tracking screens**

Replace hardcoded shipment labels/status/action copy with EN/UR ARB keys. The
transporter tab shows **Available deliveries** and **My deliveries**; its
available card uses only city/province, item count, and claim action. After a
successful claim, reload both lists. My-delivery cards reveal addresses and
only one valid next-status action. Use existing `AppCard`, `AppBadge`,
`AppButton`, `AppColors`, `AppSpacing`, and `AppTextStyles`.

Run: `flutter gen-l10n`

- [ ] **Step 5: Run focused mobile verification and commit**

Run:

```bash
flutter test test/shipments/shipments_controller_test.dart test/shipments/shipment_tracking_screen_test.dart test/orders/checkout_controller_test.dart
flutter analyze
```

Expected: PASS. The checkout regression test confirms the one-order-one-farmer
payment path remains intact.

```bash
git add lib/app lib/features/shipments lib/features/orders/presentation/screens/orders_screen.dart lib/l10n test/shipments
git commit -m "feat: add shipment self-claim tracking"
```

### Task 6: Record verified shipment-slice state

**Files:**
- Modify: `farm2fork-mobile/PROGRESS.md`

**Interfaces:**
- Consumes: completed Tasks 1–5 and their actual command output.
- Produces: an auditable tracker entry that separates automated checks from the user's Atlas/device smoke test.

- [ ] **Step 1: Run final backend verification**

Run:

```bash
pnpm run build
pnpm test
pnpm test:e2e --runInBand
```

Expected: all commands pass.

- [ ] **Step 2: Run final mobile verification**

Run:

```bash
flutter analyze
flutter test
```

Expected: all commands pass.

- [ ] **Step 3: Update the tracker with evidence and remaining gaps**

Record the exact feature-branch commits, test counts, and that the user—not
the implementation agent—will perform the Atlas Compose/device smoke test.
Keep Fabric Gateway submission/retry, maps/GPS, notifications, bids/fees,
reassignment, proof of delivery, and web integration in the deferred list.

- [ ] **Step 4: Commit the verification record**

```bash
git add PROGRESS.md
git commit -m "docs: record shipment slice verification"
```

## Plan Self-Review

- Spec coverage: Tasks 1–3 implement open-order discovery, first-claim atomicity, status ownership, order mappings, and outbox records. Tasks 4–5 implement the typed API, mock parity, transporter claim workflow, and buyer/farmer read-only tracking. Task 6 records only verified evidence.
- Placeholder scan: no unspecified endpoint, status transition, address rule, timing rule, test command, or commit target remains.
- Type consistency: backend claim uses `orderId`; mobile claim sends only `orderId`; shipment state names match the existing `ShipmentStatus` enum; updates use only `{status, note}`; all reader surfaces consume the same `ShipmentResponseDto` mapping.
