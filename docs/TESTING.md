# Testing the whole Farm2Fork flow locally

This guide gets every module running on one machine so the full flow can be
clicked through: a farmer lists produce (with AI help), a buyer orders and
pays with a fixed delivery fee, nearby transporters get the delivery offer on
their phones, one accepts and delivers, and anyone can trace the product by
its QR link. Loans, the community feed and notifications are part of it too.

Transporters are **mobile-only**. The web `/transporter` page only points to
the app.

Out of scope for now: camera QR scanning (paste or open the trace link
instead).

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
  - Cloud Messaging is on by default in the project; push notifications to
    the Android app need nothing else (the app already ships its
    `google-services.json`).
- Google Maps keys (optional but strongly recommended):
  - **Maps SDK for Android** key for the app: put `MAPS_API_KEY=...` in
    `farm2fork-mobile/android/local.properties`. Without it maps render
    blank; pins can still be set with "use my location".
  - **Maps JavaScript API** key for the web: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
    in `farm2fork-backend/.env` (used when the stack builds the web image).
    Without it, the web sets pins from the browser's location only.
  - Restrict both keys (Android package + SHA-1, web origins). Directions open
    the Google Maps app and need no key.
- Cloudinary (optional): `CLOUDINARY_URL=cloudinary://key:secret@cloud` for
  loan documents and community photos. Without it, uploads are stored on the
  API's disk under `uploads/`, which is fine for local testing.

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
| `FINANCIAL_PARTNER_EMAIL_ALLOWLIST` | the email you'll use to review loans on the web `/financial` portal |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | optional, see above |
| `CLOUDINARY_URL` | optional, see above |

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
pnpm seed:demo     # 2 demo farms (with map pins), 8 listings; safe to re-run
pnpm smoke:flow    # 22 end-to-end API checks with throwaway users
```

The smoke flow covers the pin-less farm being refused at checkout, the
delivery quote, transporters going online near and far, the offer push, a
decline, an accept (and a second accept being refused), delivery,
notifications, a loan application with a document through approval, and a
community post with a comment. A healthy stack prints
`22 passed, 0 failed, 0 skipped`, and the trace journey reports
`0/6 confirmed on ledger` unless the Fabric worker is running (section 7). The smoke run finishes by tripping the public rate limit, so
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

Use separate accounts per role (for example Gmail aliases or email sign-ups).
Web and mobile share the same backend, so you can mix clients, except
transporters, who need the app on a phone or emulator.

Delivery pricing and dispatch defaults (change them in the `system_config`
collection): base Rs 150 + Rs 25/km, straight-line distance x 1.3 for
roads, 25 km dispatch radius, a transporter location counts as current for
60 minutes. These are illustrative numbers; set real rates before any demo
that quotes prices.

**Guest (no sign-in)**
1. The web landing page "Fresh" section and the mobile marketplace list real
   listings with the farm name and city.
2. Open a listing's trace link (`/trace/<productId>`): the journey shows
   "Listed", with the origin marked as awaiting ledger confirmation.

**Farmer**
1. Sign up, choose Farmer, and complete onboarding. Street/village, city,
   province **and a map pin** of the farm gate are required (the delivery fee
   is priced from it and transporters navigate to it).
2. Create a listing. Step 1: pick a crop and run the photo quality check. The
   result is labelled as a preview while the model is untrained. Step 2:
   "Suggest a price" returns a rule-based range; apply it or type your own.
3. My Listings shows the new item with a ledger chip ("Ledger pending" / "On ledger").
   Hide it, show it again and delete it; each action reloads from the API.
4. Accounts created before this change see a "pickup location" prompt at the
   top of My Listings. Until it has a pin, buyers can't check out from this
   farm and transporters can't be matched.
5. Loans (app: Profile -> Loans): apply with an amount inside the limits, a
   repayment period and photos of documents. Only one application can be
   open at a time. You're notified when it's reviewed.
6. Community (web: Farm Feed tab, app: Feed tab): post with photos and tags,
   comment, filter by tag, remove your own post.

**Transporter (mobile app)** - do this before the buyer pays
1. Sign up as Transporter. The app opens on **Deliveries**. Flip the switch
   to go online and allow location access ("while using the app"). On an
   emulator, set a location near the farm in the emulator's extended
   controls.
2. Keep the app open, or in the background with notifications allowed.

**Buyer**
1. Sign up as Buyer, add a listing to the cart and go to checkout. Enter the
   address, then pin the drop-off. Each farmer group shows its delivery fee
   and distance before you place the order.
2. Pay with JazzCash or Stripe. With the simulator enabled, the payment
   settles immediately and the order moves to paid.
3. The bell (web) / notifications screen (app) shows order placed, payment
   confirmed and, later, the transporter and delivery updates.

**Transporter (continued)**
1. A push arrives: "New delivery · Rs ...". The offer shows the fee, the
   distance to the farm and of the trip, the items, and a map with the exact
   farm pin and the approximate (about 1 km) drop-off area.
2. Decline hides it for you. Accept makes it yours; any other transporter
   now gets "no longer available". You also stop receiving offers until
   this delivery is done.
3. The delivery card shows both pins, what you earn, and "Navigate to
   pickup", which opens Google Maps. Confirm pickup, start transit
   ("Navigate to drop-off" now points at the buyer) and confirm delivery.
   The buyer and farmer are notified at each step.

**Financial partner (web `/financial`)**
1. Sign in with the email in `FINANCIAL_PARTNER_EMAIL_ALLOWLIST`.
2. The queue shows real applications with totals computed from them. Open
   one to see the farm summary (land, crops, delivered orders and revenue)
   and the documents (links expire after about 10 minutes).
3. Start the review, then approve (creates the monthly schedule) or reject
   with a reason. Record repayments one instalment at a time; the last one
   marks the loan repaid. The farmer is notified each time.

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
