# Testing the whole Farm2Fork flow locally

This guide gets every module running on one machine so the full flow can be
clicked through: a farmer lists produce (with AI help), a buyer orders and
pays, a transporter delivers, and anyone can trace the product by its QR link.

Out of scope for now: camera QR scanning (paste or open the trace link
instead), loans, community and notifications (schema only).

## 1. What you need

- Docker with Compose v2.24+ (for `env_file: required: false`)
- Sibling checkouts on the `claude/stoic-dirac-oz2ola` branch:

  ```
  farm2fork-backend/   <- run everything from here
  farm2fork-ai/
  farm2fork-web/
  farm2fork-mobile/    (Flutter 3.x, for the app)
  farm2fork-blockchain/ (optional, for real ledger confirmation)
  ```

- The Firebase project `farm2fork-2a5b9` (sign-in for web and mobile uses
  Firebase; the API has no password login). You need:
  - an Admin SDK service-account key (Firebase console -> Project settings ->
    Service accounts -> Generate new private key);
  - the web app config (Project settings -> Your apps -> Web app);
  - Email/Password and Google providers enabled under Authentication.

## 2. Configure

```bash
cd farm2fork-backend
cp .env.example .env
```

Edit `.env`. Only these matter for the local stack. Compose overrides the
database, Redis, AI URL, CORS and cookie settings itself.

| Variable | Value |
| --- | --- |
| `JWT_SECRET` | any long random string |
| `FIREBASE_AUTH_ENABLED` | `true` |
| `FIREBASE_PROJECT_ID` | `farm2fork-2a5b9` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | `/app/farm2fork-firebase-adminsdk.json`, after copying the key file into `farm2fork-backend/` (the name is git-ignored). Or paste the whole key as one line into `FIREBASE_SERVICE_ACCOUNT_JSON`. |
| `NEXT_PUBLIC_FIREBASE_*` | the web app config values (API key, project id, app id, sender id; leave `AUTH_DOMAIN` empty locally) |
| `ADMIN_EMAIL_ALLOWLIST` | optional; your email if you want the admin role |

A host path in `GOOGLE_APPLICATION_CREDENTIALS` is ignored inside the
container. Without Firebase credentials the API still starts; sign-in then
returns 503, but the seed and smoke scripts below still work because they use
backend-signed JWTs.

## 3. Start the stack

```bash
docker compose -f docker-compose.local.yml up --build -d
docker compose -f docker-compose.local.yml ps   # wait for mongo "healthy"
```

| Service | URL |
| --- | --- |
| Web app | http://localhost:3001 |
| API + Swagger | http://localhost:3002/api, http://localhost:3002/api/docs |
| AI service | http://localhost:8000/health |
| MongoDB | `mongodb://localhost:27017/farm2fork?directConnection=true` |

If port 27017 is taken, start with `MONGO_HOST_PORT=27018` and use that port
below. If the AI image fails to download PyTorch, add
`TORCH_INDEX_URL=https://pypi.org/simple`.

## 4. Seed and smoke-test

Run these from `farm2fork-backend` on the host. They talk to the API and the
database directly, and refuse to run against a hosted cluster or
`NODE_ENV=production`.

```bash
export DATABASE_URL='mongodb://localhost:27017/farm2fork?directConnection=true'
pnpm seed:demo     # 2 demo farms, 8 listings; safe to re-run
pnpm smoke:flow    # 13 end-to-end API checks with throwaway users
```

A healthy stack prints `13 passed, 0 failed, 0 skipped`, and the trace
journey reports `0/6 confirmed on ledger` unless the Fabric worker is running
(section 7). The smoke run finishes by tripping the public rate limit, so
wait one minute before opening trace pages from the same machine.

## 5. Mobile app

The app defaults to port 3000; the local stack serves on 3002.

```bash
cd farm2fork-mobile
# Android emulator (10.0.2.2 is the host machine):
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3002/api \
            --dart-define=PAYMENT_SIMULATOR_ENABLED=true
# Physical phone on the same Wi-Fi: use the computer's LAN IP instead,
# e.g. http://192.168.1.20:3002/api
```

For QR links that open on a phone, set `PUBLIC_TRACE_ORIGIN` in `.env` to
`http://<LAN-IP>:3001` before creating listings (existing QR codes keep their
old URL).

`--dart-define=USE_MOCKS=true` runs the app on in-memory data without any
backend. That is useful for UI review only.

## 6. Test script by role

Use three separate accounts (for example three Gmail aliases or email
sign-ups). Web and mobile share the same backend, so you can mix clients.

**Guest (no sign-in)**
1. The web landing page "Fresh" section and the mobile marketplace list real
   listings with the farm name and city.
2. Open a listing's trace link (`/trace/<productId>`): the journey shows
   "Listed", with the origin marked as awaiting ledger confirmation.

**Farmer**
1. Sign up, choose Farmer, and complete onboarding. Street/village, city and
   province are required.
2. Create a listing. Step 1: pick a crop and run the photo quality check. The
   result is labelled as a preview while the model is untrained. Step 2:
   "Suggest a price" returns a rule-based range; apply it or type your own.
3. My Listings shows the new item with a ledger chip ("Ledger pending" / "On ledger").
   Hide it, show it again and delete it; each action reloads from the API.
4. Accounts created before this change see a "pickup location" prompt at the
   top of My Listings. Until it is saved, transporters cannot see their
   orders.

**Buyer**
1. Sign up as Buyer, add a listing to the cart, and check out with a delivery
   address.
2. Pay with JazzCash or Stripe. With the simulator enabled, the payment
   settles immediately as success, and the order moves to paid.

**Transporter**
1. Sign up as Transporter. Available deliveries lists the paid order with its
   pickup and drop-off cities (street addresses stay hidden until claimed).
2. Claim it, then move it through Picked up -> In transit -> Delivered.

**Traceability (anyone)**
- Reopen the product's trace link. It shows listed -> payment confirmed ->
  assigned -> picked up -> in transit -> delivered, each with its ledger
  state. No buyer identity or street address appears.
- Rapid refreshing eventually returns HTTP 429 (60 requests per minute per
  IP on trace routes).

## 7. Blockchain (optional)

Without Fabric, every event stays "Awaiting ledger confirmation". That is correct behaviour: the
UI never shows pending as verified. To confirm events on a real ledger:

```bash
cd ../farm2fork-blockchain
bash scripts/network-up.sh
bash scripts/create-channel.sh
bash scripts/deploy-chaincode.sh

cd ../farm2fork-backend
docker compose -f docker-compose.local.yml --profile fabric up -d worker
```

Within a few seconds, events become "Recorded on ledger" with a transaction
hash and block number. See `docs/fabric-worker.md` for the worker's variables.

Independent re-verification on the public trace page ("Re-checked on ledger" /
"Ledger record doesn't match") also needs `FABRIC_READ_ENABLED=true` on the API process, with
the API on the Fabric network and the crypto mount. The local stack leaves it
off, so once events are confirmed the page notes that their states come
from Farm2Fork's records rather than a fresh ledger read.

## 8. AI model

The service wraps the crop-conditioned EfficientNet grade model. Until
training finishes, it runs in a clearly labelled **untrained preview** mode
with random weights, so grades are not meaningful yet. When
`best_model.pth` is ready:

```bash
cp best_model.pth ../farm2fork-ai/models/checkpoints/grade_cond_dedup/
docker compose -f docker-compose.local.yml restart ai
curl localhost:8000/health    # qualityModel: "trained"
```

No code changes are needed. Price suggestions come from
`farm2fork-ai/configs/price_rules.yaml`. Those values are illustrative and
should be replaced with sourced market rates before any demo that quotes
prices.

## 9. Automated suites

```bash
# backend
pnpm exec jest --runInBand
CI=true pnpm test:e2e -- --runInBand --testPathPattern 'traceability|blockchain-outbox'
# web
cd ../farm2fork-web && pnpm test && pnpm lint
# mobile
cd ../farm2fork-mobile && flutter analyze && flutter test
# ai
cd ../farm2fork-ai && pytest
```

`test/app.e2e-spec.ts` fails on `develop` as well, because of the Fabric
SDK's ESM loading under Jest. That failure predates this work.

## 10. Reset

```bash
docker compose -f docker-compose.local.yml down -v   # also wipes Mongo data
```
