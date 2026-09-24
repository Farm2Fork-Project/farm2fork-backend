#!/usr/bin/env node
// End-to-end smoke test of the whole backend flow against a running local
// stack. Creates throwaway users for this run (tagged with a run id) and
// drives the real HTTP API through every step a tester would click:
//
//   farmer lists -> guest browses -> AI price/quality -> buyer orders and
//   pays (simulator) -> transporter claims and delivers -> public trace
//
//   pnpm smoke:flow
//
// Requires PAYMENT_SIMULATOR_ENABLED=true on the API (local only). The AI
// steps are reported as skipped, not failed, when the AI service is down.
import { randomBytes } from 'node:crypto';
import { apiClient, connect, ensureUser, fail, requireLocalEnv, tokenFor } from './dev-client.mjs';

const env = requireLocalEnv();
const call = apiClient(env.apiUrl);
const run = randomBytes(3).toString('hex');
const results = [];

async function step(name, fn, { optional = false } = {}) {
  try {
    const detail = await fn();
    results.push({ name, status: 'pass', detail });
    console.log(`  ✔ ${name}${detail ? `  — ${detail}` : ''}`);
    return true;
  } catch (error) {
    const status = optional ? 'skip' : 'fail';
    results.push({ name, status, detail: error.message });
    console.log(`  ${optional ? '○' : '✖'} ${name}  — ${error.message}`);
    return false;
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const connection = await connect(env.databaseUrl).catch((e) => fail(`MongoDB: ${e.message}`));
await call('GET', '/health').catch((e) => fail(`API not reachable at ${env.apiUrl}: ${e.message}`));
const db = connection.db;

console.log(`\nFarm2Fork smoke flow (run ${run}) against ${env.apiUrl}\n`);

const farmer = await ensureUser(db, {
  email: `smoke.${run}.farmer@farm2fork.test`,
  role: 'farmer',
  profile: {
    farmName: `Smoke Farm ${run}`,
    cnic: `SMOKE-${run}`,
    // Deliberately incomplete (no street), as older app onboarding saved it.
    farmLocation: { city: 'Multan' },
    cropTypes: ['mango'],
    certifications: [],
  },
});
const buyer = await ensureUser(db, {
  email: `smoke.${run}.buyer@farm2fork.test`,
  role: 'buyer',
  profile: {
    businessName: `Smoke Mart ${run}`,
    cnic: `SMOKE-B-${run}`,
    businessType: 'retailer',
    deliveryAddress: { street: '21 Market Road', city: 'Lahore', province: 'Punjab' },
  },
});
const transporter = await ensureUser(db, {
  email: `smoke.${run}.transporter@farm2fork.test`,
  role: 'transporter',
});
const tokens = {
  farmer: tokenFor(farmer, env.jwtSecret),
  buyer: tokenFor(buyer, env.jwtSecret),
  transporter: tokenFor(transporter, env.jwtSecret),
};

let product;
let order;
let payment;
let shipment;

console.log('Marketplace');
await step('Farmer publishes a listing', async () => {
  product = await call('POST', '/products', {
    token: tokens.farmer,
    body: { name: `Smoke Mangoes ${run}`, category: 'fruits', price: 300, quantity: 50, unit: 'kg', qualityGrade: 'A' },
  });
  expect(product.initialBlockchainRecordId, 'no listed ledger record linked');
  expect(/\/trace\//.test(product.qrCode ?? ''), `unexpected QR url ${product.qrCode}`);
  return `QR → ${product.qrCode}`;
});
await step('Guest browses without signing in', async () => {
  const page = await call('GET', `/products?search=${encodeURIComponent(`Smoke Mangoes ${run}`)}`);
  const found = page.data.find((p) => p.id === product?.id);
  expect(found, 'listing not visible to guests');
  expect(found.farmer?.farmName === `Smoke Farm ${run}`, 'farm identity missing');
  return `farm "${found.farmer.farmName}", ledger ${found.originLedgerStatus}`;
});
await step('Public trace shows the listing', async () => {
  const trace = await call('GET', `/trace/products/${product.id}`);
  expect(trace.events[0]?.type === 'listed', 'first event is not "listed"');
  return `origin ledger ${trace.events[0].ledger.status}, ledgerCheck ${trace.summary.ledgerCheck}`;
});

console.log('AI (farmer)');
await step(
  'Price suggestion',
  async () => {
    const price = await call('POST', '/ai/price', {
      token: tokens.farmer,
      body: { productName: 'Chaunsa Mangoes', category: 'fruits', unit: 'kg', qualityGrade: 'A' },
    });
    return `Rs ${price.predictedMinPrice}–${price.predictedMaxPrice}/kg (${price.method})`;
  },
  { optional: true },
);
await step(
  'Photo quality check',
  async () => {
    // A 1x1 JPEG is enough to exercise the full upload -> model -> store path.
    const jpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
      'base64',
    );
    const form = new FormData();
    form.append('crop', 'mango');
    form.append('image', new Blob([jpeg], { type: 'image/jpeg' }), 'smoke.jpg');
    const result = await call('POST', '/ai/quality', { token: tokens.farmer, form });
    return `grade ${result.modelGrade} @ ${Math.round(result.confidenceScore * 100)}% (${result.modelStatus} model)`;
  },
  { optional: true },
);

console.log('Order & payment (buyer)');
await step('Buyer places an order', async () => {
  const created = await call('POST', '/orders', {
    token: tokens.buyer,
    body: {
      items: [{ productId: product.id, quantity: 5 }],
      shippingAddress: { street: '21 Market Road', city: 'Lahore', province: 'Punjab' },
    },
  });
  order = Array.isArray(created) ? created[0] : created;
  expect(order?.id, 'no order id');
  return `order ${order.id}, grand total Rs ${order.grandTotal}`;
});
await step('Buyer pays (payment simulator)', async () => {
  const initiated = await call('POST', '/payments', {
    token: tokens.buyer,
    body: { orderId: order.id, gateway: 'jazzcash' },
  });
  payment = initiated.payment ?? initiated;
  const settled = await call('POST', `/payments/${payment.id}/simulate`, {
    token: tokens.buyer,
    body: { status: 'success' },
  }).catch((error) => {
    if (error.status === 403 || error.status === 404) {
      throw new Error('simulator disabled - set PAYMENT_SIMULATOR_ENABLED=true on the API');
    }
    throw error;
  });
  expect(settled.status === 'success', `payment status ${settled.status}`);
  return 'payment success';
});

console.log('Farm location (farmer)');
await step('Incomplete farm location is reported', async () => {
  const location = await call('GET', '/farmers/me/farm-location', { token: tokens.farmer });
  expect(location.complete === false, 'expected an incomplete location');
  const available = await call('GET', '/shipments/available', { token: tokens.transporter });
  expect(!available.some((d) => d.orderId === order?.id), 'order visible without a pickup address');
  return 'order withheld from transporters until the farm location is complete';
});
await step('Farmer completes the farm location', async () => {
  const location = await call('PATCH', '/farmers/me/farm-location', {
    token: tokens.farmer,
    body: { address: 'Chak 5, Canal Road', city: 'Multan', province: 'Punjab' },
  });
  expect(location.complete === true, 'location still incomplete');
  return `${location.address}, ${location.city}, ${location.province}`;
});

console.log('Delivery (transporter)');
await step('Paid order is offered to transporters', async () => {
  const available = await call('GET', '/shipments/available', { token: tokens.transporter });
  expect(available.some((d) => d.orderId === order.id), 'order not in available deliveries');
  return `${available.length} available`;
});
await step('Transporter claims and delivers', async () => {
  shipment = await call('POST', '/shipments/claims', { token: tokens.transporter, body: { orderId: order.id } });
  for (const status of ['picked_up', 'in_transit', 'delivered']) {
    shipment = await call('PATCH', `/shipments/${shipment.id}/status`, {
      token: tokens.transporter,
      body: { status, note: `smoke ${status}` },
    });
  }
  expect(shipment.status === 'delivered', `ended as ${shipment.status}`);
  return 'assigned → picked_up → in_transit → delivered';
});

console.log('Traceability');
await step('Journey records the whole supply chain', async () => {
  const trace = await call('GET', `/trace/products/${product.id}`);
  const types = trace.events.map((e) => e.type);
  for (const expected of ['listed', 'payment_confirmed', 'shipment_assigned', 'shipment_picked_up', 'shipment_in_transit', 'shipment_delivered']) {
    expect(types.includes(expected), `missing ${expected} (got ${types.join(', ')})`);
  }
  const serialized = JSON.stringify(trace);
  expect(!serialized.includes(buyer._id.toHexString()), 'buyer id leaked in public trace');
  expect(!serialized.includes('21 Market Road'), 'street address leaked in public trace');
  return `${trace.summary.confirmedEvents}/${trace.summary.totalEvents} confirmed on ledger`;
});
await step('Public endpoints are rate limited', async () => {
  let limited = false;
  for (let i = 0; i < 70 && !limited; i += 1) {
    limited = await call('GET', `/trace/products/${product.id}`).then(
      () => false,
      (e) => e.status === 429,
    );
  }
  expect(limited, 'no 429 after 70 rapid trace requests');
  return '429 returned after the per-minute budget';
});

await connection.close();
const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skip');
console.log(
  `\n${failed.length ? '✖' : '✔'} ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
);
if (skipped.length) console.log('  Skipped steps need the AI service (AI_SERVICE_URL).');
if (product) console.log(`  Open the journey: ${product.qrCode}`);
process.exit(failed.length ? 1 : 0);
