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
docker compose --env-file .env.example config
docker compose up backend-worker redis
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
