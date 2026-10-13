# Shipment Self-Claim and Delivery Tracking Design

**Status:** Approved 2026-08-11

## Goal

Deliver the next vertical slice after payment: transporters discover and claim
available paid orders, progress an assigned shipment through delivery, and
buyers/farmers can read the resulting delivery timeline.

The flow borrows the useful part of inDrive's model—providers choose suitable
open requests—without introducing ride-style fare negotiation. Farm2Fork has
no transport-price contract, offer expiry, counter-offer, or dispute policy yet;
those are deliberately out of scope.

## Availability and Claim Rules

- An available delivery is derived from an `Order` where `status = paid` and
  `shipmentId` is absent. No placeholder `Shipment` is created before a claim;
  this preserves the master shipment status enum, whose first state is
  `assigned`.
- Only authenticated transporters can list or claim available deliveries.
  Available-list data contains pickup/delivery city and province, item count,
  and the order creation time; it excludes street addresses and buyer contact
  data.
- A claim requires the farmer profile to have a complete farm location
  (address, city, province). Orders without it are not available for claim and
  return a clear validation error rather than creating an undeliverable
  shipment.
- `POST /shipments/claims` takes an `orderId`. The backend performs the claim
  transactionally: it rechecks that the order is paid and unclaimed, creates
  the shipment in `assigned`, appends its first history entry, sets
  `order.shipmentId`, changes the order to `processing`, and sets
  `estimatedDelivery` to the claim time plus 48 hours.
- The order-level unique shipment index and transaction make the first claim
  win. A concurrent or later claim returns `409 Conflict`; it must never
  overwrite the current transporter.
- Claiming establishes no delivery fee and does not change the payment amount.

## Shipment State and Ownership

```text
available paid order --claim--> assigned shipment
assigned --pickup--> picked_up --depart--> in_transit --deliver--> delivered
assigned | picked_up | in_transit --fail--> failed
```

- Only the assigned transporter may make a state transition.
- Valid forward transitions are enforced server-side. `failed` is terminal;
  no reassign, retry, or cancellation workflow is part of this slice.
- Each transition appends `{ status, timestamp, note, updatedBy }` to
  `statusHistory`. `updatedBy` is the authenticated transporter's user id,
  never a client-supplied id or email.
- `picked_up` and `in_transit` set the order status to `shipped`; `delivered`
  sets it to `delivered` and sets `actualDelivery`; `failed` leaves the order
  in its current `processing` or `shipped` state for manual resolution.
- A claim and every state transition create one pending typed
  `BlockchainTransaction` supply-chain outbox record. Fabric submission and
  retries remain asynchronous follow-on work.

## Read API and Mobile Surfaces

- `GET /shipments/available` is transporter-only.
- `GET /shipments` is role-scoped: transporters see assigned shipments; buyers
  see shipments for their orders; farmers see shipments for their orders.
- `POST /shipments/claims` is transporter-only.
- `PATCH /shipments/:id/status` is transporter-only and accepts only the next
  valid state plus a bounded note.
- Mobile receives a typed API repository selected by `AppConfig.useMocks`.
  Transporters get separate **Available deliveries** and **My deliveries**
  lists, a confirmation before claiming, and the next valid status action.
  Buyers/farmers get a read-only timeline; no hardcoded timeline stages are
  rendered.

## Explicitly Out of Scope

- Transporter bids, buyer/farmer offer selection, transport fees, and payouts.
- Notifications, maps/GPS tracking, ETA calculation beyond the fixed 48-hour
  default, proof-of-delivery uploads, cancellation/reassignment, and ratings.
- Fabric Gateway SDK submission/retry execution and web-client integration.

## Verification

- Backend tests cover available-delivery filtering, role boundaries,
  concurrent first-claim behavior, transition validation, order updates, and
  blockchain outbox creation.
- A Mongo replica-set integration test proves that two concurrent claims yield
  exactly one shipment and one order assignment.
- Mobile tests cover API mapping, transporter claim/status control behavior,
  buyer/farmer read-only tracking, and all new EN/UR copy.
- The tracker records exact commands that pass, separately from Atlas/device
  validation performed by the user.
