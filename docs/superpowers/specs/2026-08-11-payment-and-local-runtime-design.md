# Payment Slice and Local Runtime Design

**Status:** Approved 2026-08-11

## Goal

Deliver the first production-shaped payment flow for the existing order API and
Flutter checkout flow. The first release uses a simulated gateway, but preserves
the boundaries needed to add JazzCash or Stripe later.

## Scope

- Containerize the NestJS backend and a local Redis instance with Docker
  Compose.
- Use MongoDB Atlas via `DATABASE_URL`; MongoDB is not a Compose service.
- Replace DTO-shaped mock payment responses with persisted payment behavior.
- Make a payment success transition atomically update the payment, order, and
  product stock.
- Wire the Flutter app from checkout to payment initiation and payment status.
- Record a pending blockchain transaction after successful payment, without
  requiring Fabric SDK integration in this slice.
- Update the project progress tracker and keep a focused commit per repository.

## Explicitly Out of Scope

- Real JazzCash or Stripe credentials, hosted checkout, or gateway-specific
  signature verification.
- Fabric Gateway SDK integration or retry worker execution.
- Web-client API integration.
- MongoDB containers, local production data, or mobile runtime containers.

## Local Runtime

`docker compose up` runs `backend` and `redis` only. The backend receives
`DATABASE_URL` for Atlas and `REDIS_URL=redis://redis:6379` through an
uncommitted `.env` file. `.env.example` documents required values without
containing credentials. Health checks ensure Redis is ready before the backend
starts.

Flutter is a native mobile client, so it is not a Docker runtime service. Its
tests or Android build may later run in a container, but it must still run on a
native emulator or device during normal development.

## Payment Data Flow

```text
buyer -> POST /payments -> persisted pending payment
buyer -> simulated completion -> POST /payments/webhook/simulated
backend -> idempotent success handling:
  payment pending -> success
  order pending -> paid
  decrement each product's stock exactly once
  create a pending blockchain_transactions record
backend -> return payment status to mobile
```

The client is never trusted to set payment success, order status, payable
amount, or product stock. The backend derives the amount from `order.grandTotal`
and verifies that the authenticated buyer owns the order.

## State and Consistency Rules

- A payment is unique per order. A buyer cannot create a second payment for the
  same order.
- Only a `pending` order can receive a new payment.
- The simulated webhook identifies a payment with its gateway reference and may
  be replayed. Replaying the same successful callback returns the settled
  payment without reapplying stock or creating another blockchain record.
- A success callback uses a MongoDB transaction to update payment, order, and
  product stock together. Insufficient stock or an invalid order state fails
  the payment rather than partially changing inventory.
- Refund behavior stays on the existing admin endpoint. The first slice does
  not restock automatically; that policy needs a separate, explicit design.
- Gateway references, callback details, and credentials never appear in client
  responses or logs.

## API and Mobile Contract

The existing payment endpoints remain the contract:

- `POST /payments` creates or returns a pending payment for an owned order.
- `GET /payments` and `GET /payments/:id` return persisted, role-scoped data.
- `POST /payments/webhook/:gateway` is a controlled simulated callback in this
  slice and moves a payment to `success` or `failed`.

The mobile checkout creates one order per farmer group as it does today. It then
initiates one payment per created order, shows pending/success/failed state, and
reloads orders from the backend. It sends no derived payment totals or stock
updates.

## Verification

- Backend unit tests cover ownership, duplicate initiation, invalid state,
  successful settlement, failed settlement, callback replay, and stock changes.
- Backend integration tests use a Mongo replica set or a test equivalent that
  supports transactions.
- Mobile tests cover the payment repository/controller success, failure, and
  partial multi-farmer checkout outcomes.
- `docker compose config`, backend build/tests, Flutter analysis/tests, and a
  manual Atlas-backed Compose smoke test are recorded in the progress tracker.

## Follow-on Work

Fabric Gateway integration consumes the persisted pending blockchain transaction
record asynchronously with bounded retries. Shipment tracking follows, creating
the remaining supply-chain events needed for a real traceability journey.
