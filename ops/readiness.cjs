// Read-only production checks. Runs with submission worker disabled.
const requireApp = require('node:module').createRequire('/app/package.json');
const { NestFactory } = requireApp('@nestjs/core');
const { getConnectionToken } = requireApp('@nestjs/mongoose');
const { AppModule } = require('/app/dist/app.module');
const { FabricGatewayService } = require('/app/dist/modules/blockchain/fabric-gateway.service');
const Redis = requireApp('ioredis');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  let redis;
  try {
    const connection = app.get(getConnectionToken());
    const hello = await connection.db.admin().command({ hello: 1 });
    if (!hello.setName) throw new Error('MongoDB replica set required');
    await connection.db.admin().ping();
    redis = new Redis(process.env.REDIS_URL, { connectTimeout: 5000, maxRetriesPerRequest: 1 });
    if (await redis.ping() !== 'PONG') throw new Error('Redis ping failed');
    const fabric = app.get(FabricGatewayService);
    if (!fabric.isAvailable()) throw new Error('Fabric gateway unavailable');
    await fabric.findByLedgerKey('deployment-read-probe');
    const response = await fetch(process.env.AI_SERVICE_URL + '/predict/price', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': process.env.AI_SERVICE_TOKEN },
      body: JSON.stringify({ productName: 'mango', category: 'fruits', unit: 'kg' }),
    });
    if (!response.ok || (await response.json()).currency !== 'PKR') throw new Error('AI pricing failed');
    console.log('MongoDB replica set, Redis, Fabric ledger evaluation and AI pricing passed');
  } finally {
    redis?.disconnect();
    await app.close();
  }
}
const timer = setTimeout(() => { console.error('Readiness timed out'); process.exit(1); }, 60000);
main().then(() => { clearTimeout(timer); process.exit(0); }).catch(() => {
  console.error('Dependency readiness failed; inspect service logs on EC2');
  process.exit(1);
});
