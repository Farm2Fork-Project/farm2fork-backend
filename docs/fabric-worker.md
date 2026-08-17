# Fabric outbox worker

`backend-worker` is a dedicated Nest application context. It does not publish
an HTTP port and is the only backend service connected to the Fabric Docker
network.

## Local startup

```bash
cd ../farm2fork-blockchain
bash scripts/network-up.sh
bash scripts/create-channel.sh
bash scripts/deploy-chaincode.sh

cd ../farm2fork-backend
DATABASE_URL='<Atlas connection URI>' \
FABRIC_CRYPTO_HOST_PATH='../farm2fork-blockchain/network/organizations' \
docker compose --env-file .env.example config

DATABASE_URL='<Atlas connection URI>' \
FABRIC_CRYPTO_HOST_PATH='../farm2fork-blockchain/network/organizations' \
docker compose --env-file .env.example up backend-worker redis
```

The worker requires a real Atlas `DATABASE_URL`; the value in `.env.example`
is only a placeholder. It also requires `FABRIC_CRYPTO_HOST_PATH`, pointing to
the blockchain repository's `network/organizations` directory. The directory
is mounted read-only at `/fabric/crypto` and is never copied into an image.

Required Fabric variables are `BLOCKCHAIN_WORKER_ENABLED=true`,
`FABRIC_CRYPTO_HOST_PATH`, `FABRIC_CHANNEL_NAME`, `FABRIC_CHAINCODE_NAME`,
`FABRIC_MSP_ID`, `FABRIC_PEER_ENDPOINT`, and `FABRIC_PEER_HOST_ALIAS`. The
Compose service sets certificate and key paths beneath `/fabric/crypto`.

`FABRIC_DOCKER_NETWORK` defaults to `farm2fork-fabric`; set it only if the
blockchain network uses a different external Docker network name.

The local Fabric defaults are channel `farm2forkchannel` and chaincode
`farm2fork-chaincode`.

`farm2fork-backend/.env.example` now lists every non-secret Fabric variable.
Keep `BLOCKCHAIN_WORKER_ENABLED=false` for the HTTP `backend` service; Compose
sets it to `true` only for `backend-worker`. Do not set the three
`FABRIC_*_PATH` variables in `.env`: Compose derives their in-container values
from the read-only `FABRIC_CRYPTO_HOST_PATH` mount.

## Verified live boundary

On 2026-08-11, the local worker was verified against the user-provided Atlas
database and the local Fabric network with this runtime shape:

```bash
FABRIC_CRYPTO_HOST_PATH='../farm2fork-blockchain/network/organizations' \
docker compose --env-file .env up -d redis backend-worker
```

One explicitly approved, test-only payment document was inserted directly into
`blockchain_transactions`; no user order, payment, shipment, or product was
used. The worker marked it `confirmed` with Fabric commit-status block `6`,
and a separate `GetTransactionByLedgerKey` query returned the immutable
`fabric-smoke` payment record. The normal payment/shipment-flow smoke and
full backend e2e suite remain open.

## Automated outbox verification

The focused replica-set suite covers two workers attempting the same pending
record concurrently and recovery when Fabric already contains the immutable
ledger key. It passed on 2026-08-11:

```bash
CI=true pnpm test:e2e -- --runInBand --testPathPattern blockchain-outbox
```

The backend unit suite (`84` tests) and production build also passed with:

```bash
CI=true pnpm exec jest --runInBand
CI=true pnpm run build
```

The broader backend e2e suite remains unverified because Jest currently has an
ESM runtime conflict when it loads the Fabric Gateway dependency.
