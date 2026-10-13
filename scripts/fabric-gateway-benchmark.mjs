import * as grpc from '@grpc/grpc-js';
import { connect, signers } from '@hyperledger/fabric-gateway';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { assertSuccessfulCommit } from './lib/fabric-commit-status.mjs';

const operations = Number(process.env.BENCHMARK_OPERATIONS ?? 100);
const concurrency = Number(process.env.BENCHMARK_CONCURRENCY ?? 10);
const cryptoRoot = process.env.FABRIC_CRYPTO_HOST_PATH ?? '../farm2fork-blockchain/network/organizations';
const peer = process.env.FABRIC_PEER_ENDPOINT ?? 'localhost:7051';
const alias = process.env.FABRIC_PEER_HOST_ALIAS ?? 'peer0.farm2fork.com';
const channel = process.env.FABRIC_CHANNEL_NAME ?? 'farm2forkchannel';
const chaincode = process.env.FABRIC_CHAINCODE_NAME ?? 'farm2fork-chaincode';
const mspId = process.env.FABRIC_MSP_ID ?? 'Farm2ForkMSP';
const base = `${cryptoRoot}/peerOrganizations/farm2fork.com`;

if (!Number.isInteger(operations) || operations < 1 || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('BENCHMARK_OPERATIONS and BENCHMARK_CONCURRENCY must be positive integers');
const [tls, cert, key] = await Promise.all([
    readFile(`${base}/peers/peer0.farm2fork.com/tls/ca.crt`),
    readFile(`${base}/users/Admin@farm2fork.com/msp/signcerts/Admin@farm2fork.com-cert.pem`),
    readFile(`${base}/users/Admin@farm2fork.com/msp/keystore/priv_sk`),
]);
const client = new grpc.Client(peer, grpc.credentials.createSsl(tls), { 'grpc.ssl_target_name_override': alias });
const gateway = connect({ client, identity: { mspId, credentials: cert }, signer: signers.newPrivateKeySigner(createPrivateKey(key)) });
const contract = gateway.getNetwork(channel).getContract(chaincode);
const runId = `gateway-${randomUUID()}`;
const build = (i, event, model, role) => [`${runId}-${event}-${i}`, model === 'Product' ? `${runId}-product-${i}` : `${runId}-shipment-${i}`, model, `${runId}-product-${i}`, `${runId}-farmer-${i}`, event, 'Lahore, Punjab', `${runId}-${role}-${i}`, role, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()];
const run = async (name, fn) => { const start = performance.now(), lat = []; let n = 0; await Promise.all(Array.from({ length: Math.min(concurrency, operations) }, async () => { while (n < operations) { const i = ++n, t = performance.now(); await fn(i); lat.push(performance.now() - t) } })); lat.sort((a, b) => a - b); return { name, count: operations, elapsedMs: performance.now() - start, throughputTps: operations * 1000 / (performance.now() - start), p50Ms: lat[Math.ceil(lat.length * .5) - 1], p95Ms: lat[Math.ceil(lat.length * .95) - 1] }; };
const submit = async args => assertSuccessfulCommit(await (await contract.submitAsync('RecordSupplyChainEvent', { arguments: args, endorsingOrganizations: [mspId] })).getStatus());
const listing = await run('Listing Event', i => submit(build(i, 'listed', 'Product', 'farmer')));
const shipment = await run('Shipment Event', i => submit(build(i, 'shipment_in_transit', 'Shipment', 'transporter')));
const query = await run('Product History Query', i => contract.evaluateTransaction('GetTransactionsByProductId', `${runId}-product-${i}`));
const result = { runId, measuredAt: new Date().toISOString(), path: 'Fabric Gateway gRPC/TLS direct submission or evaluation', operations, concurrency, rows: [listing, shipment, query] };
await mkdir('benchmark/results', { recursive: true }); await writeFile(`benchmark/results/${runId}.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); gateway.close(); client.close();
