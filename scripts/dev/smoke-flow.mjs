#!/usr/bin/env node
// End-to-end smoke test of the whole backend flow against a running local
// stack. Creates throwaway users for this run (tagged with a run id) and
// drives the real HTTP API through every step a tester would click:
//
//   farmer lists -> guest browses -> AI price/quality -> farm pin + delivery
//   quote -> buyer orders and pays (simulator) -> nearby transporters are
//   offered the delivery -> one declines, one accepts and delivers ->
//   notifications -> public trace -> loan application and review ->
//   community post and comment
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

async function expectStatus(promise, status, message) {
  const outcome = await promise.then(
    () => null,
    (error) => error.status,
  );
  expect(outcome === status, `${message} (got ${outcome ?? 'success'})`);
}

// A farm near Sheikhupura, a buyer in Lahore (~30 km) and transporters
// around the farm; one transporter is ~120 km away in Faisalabad.
const FARM = { lat: 31.6, lng: 74.05 };
const DROPOFF = { lat: 31.5204, lng: 74.3587 };
const NEAR_FARM = { lat: 31.62, lng: 74.08 };
const FAISALABAD = { lat: 31.418, lng: 73.079 };

// Tiny valid files for upload steps.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const connection = await connect(env.databaseUrl).catch((e) => fail(`MongoDB: ${e.message}`));
await call('GET', '/health').catch((e) => fail(`API not reachable at ${env.apiUrl}: ${e.message}`));
const db = connection.db;

console.log(`\nFarm2Fork smoke flow (run ${run}) against ${env.apiUrl}\n`);

const transporterProfile = (n) => ({
  vehicleType: 'van',
  vehicleNumber: `LEA-${run}-${n}`,
  licenseNumber: `LIC-${run}-${n}`,
  cnic: `SMOKE-T${n}-${run}`,
  serviceAreas: [],
  isAvailable: false,
});
const farmer = await ensureUser(db, {
  email: `smoke.${run}.farmer@farm2fork.test`,
  role: 'farmer',
  profile: {
    farmName: `Smoke Farm ${run}`,
    cnic: `SMOKE-${run}`,
    // Deliberately incomplete (no street, no pin), as older onboarding saved it.
    farmLocation: { city: 'Sheikhupura' },
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
const driver = await ensureUser(db, {
  email: `smoke.${run}.driver@farm2fork.test`,
  role: 'transporter',
  profile: transporterProfile(1),
});
const decliner = await ensureUser(db, {
  email: `smoke.${run}.decliner@farm2fork.test`,
  role: 'transporter',
  profile: transporterProfile(2),
});
const farDriver = await ensureUser(db, {
  email: `smoke.${run}.far@farm2fork.test`,
  role: 'transporter',
  profile: transporterProfile(3),
});
const partner = await ensureUser(db, {
  email: `smoke.${run}.partner@farm2fork.test`,
  role: 'financial_partner',
});
const tokens = Object.fromEntries(
  Object.entries({ farmer, buyer, driver, decliner, farDriver, partner }).map(([k, u]) => [
    k,
    tokenFor(u, env.jwtSecret),
  ]),
);

const shippingAddress = { street: '21 Market Road', city: 'Lahore', province: 'Punjab', ...DROPOFF };
let product;
let quote;
let order;
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
    const form = new FormData();
    form.append('crop', 'mango');
    form.append('image', new Blob([JPEG], { type: 'image/jpeg' }), 'smoke.jpg');
    const result = await call('POST', '/ai/quality', { token: tokens.farmer, form });
    return `grade ${result.modelGrade} @ ${Math.round(result.confidenceScore * 100)}% (${result.modelStatus} model)`;
  },
  { optional: true },
);

console.log('Farm pin and delivery price');
const cart = () => ({ items: [{ productId: product.id, quantity: 5 }], shippingAddress });
await step('Checkout is blocked while the farm has no map pin', async () => {
  const location = await call('GET', '/farmers/me/farm-location', { token: tokens.farmer });
  expect(location.complete === false, 'expected an incomplete location');
  await expectStatus(
    call('POST', '/orders/quote', { token: tokens.buyer, body: cart() }),
    400,
    'quote should fail without a farm pin',
  );
  return 'quote refused until the farm is pinned';
});
await step('Farmer completes the farm location with a pin', async () => {
  const location = await call('PATCH', '/farmers/me/farm-location', {
    token: tokens.farmer,
    body: { address: 'Chak 12, Canal Road', city: 'Sheikhupura', province: 'Punjab', ...FARM },
  });
  expect(location.complete === true, 'location still incomplete');
  return `${location.address}, ${location.city} @ ${location.lat}, ${location.lng}`;
});
await step('Buyer sees the fixed delivery fee before ordering', async () => {
  quote = await call('POST', '/orders/quote', { token: tokens.buyer, body: cart() });
  expect(quote.deliveryFee > 0 && quote.deliveryDistanceKm > 20, `unexpected quote ${JSON.stringify(quote)}`);
  expect(
    quote.grandTotal === quote.totalAmount + quote.platformFeeAmount + quote.deliveryFee,
    'grand total does not add up',
  );
  return `items Rs ${quote.totalAmount} + fee Rs ${quote.platformFeeAmount} + delivery Rs ${quote.deliveryFee} (${quote.deliveryDistanceKm} km) = Rs ${quote.grandTotal}`;
});

console.log('Transporters go online');
await step('Nearby and far transporters share their location', async () => {
  for (const [token, location] of [
    [tokens.driver, NEAR_FARM],
    [tokens.decliner, NEAR_FARM],
    [tokens.farDriver, FAISALABAD],
  ]) {
    const status = await call('PUT', '/shipments/transporter/availability', {
      token,
      body: { online: true, location },
    });
    expect(status.online && status.locationFresh, 'transporter not online');
  }
  await expectStatus(
    call('PUT', '/shipments/transporter/availability', { token: tokens.driver, body: { online: true } }),
    400,
    'going online without a location should be refused',
  );
  return '3 online (2 near the farm, 1 in Faisalabad)';
});

console.log('Order & payment (buyer)');
await step('Buyer places the order at the quoted price', async () => {
  order = await call('POST', '/orders', { token: tokens.buyer, body: cart() });
  expect(order.grandTotal === quote.grandTotal, `charged ${order.grandTotal}, quoted ${quote.grandTotal}`);
  expect(order.deliveryFee === quote.deliveryFee, 'delivery fee changed');
  return `order ${order.id}, Rs ${order.grandTotal}`;
});
await step('Buyer pays (payment simulator)', async () => {
  const initiated = await call('POST', '/payments', {
    token: tokens.buyer,
    body: { orderId: order.id, gateway: 'jazzcash' },
  });
  const payment = initiated.payment ?? initiated;
  expect(payment.amount === order.grandTotal, 'payment amount differs from the order total');
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

console.log('Dispatch (transporters)');
await step('Nearby transporters were pinged with the offer', async () => {
  // Dispatch runs right after the payment commits; give it a moment.
  let offer;
  for (let i = 0; i < 20 && !offer; i += 1) {
    const inbox = await call('GET', '/notifications?limit=10', { token: tokens.driver });
    offer = inbox.data.find((n) => n.type === 'delivery_offer' && n.relatedEntityId === order.id);
    if (!offer) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(offer, 'no delivery_offer notification for the nearby transporter');
  const far = await call('GET', '/notifications?limit=10', { token: tokens.farDriver });
  expect(!far.data.some((n) => n.relatedEntityId === order.id), 'far transporter was pinged');
  return `"${offer.title}" — ${offer.message}`;
});
await step('Offer shows pickup, approximate drop-off and the fixed fee', async () => {
  const offers = await call('GET', '/shipments/available', { token: tokens.driver });
  const offer = offers.find((o) => o.orderId === order.id);
  expect(offer, 'order not offered to the nearby transporter');
  expect(offer.deliveryFee === order.deliveryFee, 'offer fee differs from the order');
  expect(!JSON.stringify(offer).includes('21 Market Road'), 'buyer street leaked before acceptance');
  const far = await call('GET', '/shipments/available', { token: tokens.farDriver });
  expect(!far.some((o) => o.orderId === order.id), 'offered to a transporter 120 km away');
  return `Rs ${offer.deliveryFee}, ${offer.distanceToPickupKm} km to pickup, drop-off area ${offer.dropoffArea.lat}, ${offer.dropoffArea.lng}`;
});
await step('A transporter declines and no longer sees the offer', async () => {
  await call('POST', `/shipments/offers/${order.id}/decline`, { token: tokens.decliner });
  const offers = await call('GET', '/shipments/available', { token: tokens.decliner });
  expect(!offers.some((o) => o.orderId === order.id), 'declined offer still listed');
  return 'declined';
});
await step('Another accepts; nobody else can', async () => {
  shipment = await call('POST', '/shipments/claims', { token: tokens.driver, body: { orderId: order.id } });
  expect(shipment.deliveryFee === order.deliveryFee, 'fee not carried to the shipment');
  expect(shipment.deliveryAddress.street === '21 Market Road', 'full drop-off not revealed after accepting');
  await expectStatus(
    call('POST', '/shipments/claims', { token: tokens.decliner, body: { orderId: order.id } }),
    409,
    'second accept should conflict',
  );
  const status = await call('GET', '/shipments/transporter/status', { token: tokens.driver });
  expect(status.activeShipmentId === shipment.id, 'active delivery not reported');
  const offers = await call('GET', '/shipments/available', { token: tokens.driver });
  expect(offers.length === 0, 'offers shown during a delivery in progress');
  return `shipment ${shipment.id}, earns Rs ${shipment.deliveryFee}`;
});
await step('Transporter delivers', async () => {
  for (const status of ['picked_up', 'in_transit', 'delivered']) {
    await call('PUT', '/shipments/transporter/location', { token: tokens.driver, body: NEAR_FARM });
    shipment = await call('PATCH', `/shipments/${shipment.id}/status`, {
      token: tokens.driver,
      body: { status, note: `smoke ${status}` },
    });
  }
  expect(shipment.status === 'delivered', `ended as ${shipment.status}`);
  return 'assigned → picked_up → in_transit → delivered';
});

console.log('Notifications');
await step('Buyer inbox tells the whole story', async () => {
  let types = [];
  for (let i = 0; i < 20; i += 1) {
    const inbox = await call('GET', '/notifications?limit=20', { token: tokens.buyer });
    types = inbox.data.map((n) => n.type);
    if (types.filter((t) => t === 'delivery_update').length >= 3) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  for (const expected of ['order_placed', 'payment_confirmed', 'shipment_assigned', 'delivery_update']) {
    expect(types.includes(expected), `missing ${expected} (got ${types.join(', ')})`);
  }
  await call('POST', '/notifications/read-all', { token: tokens.buyer });
  const { unread } = await call('GET', '/notifications/unread-count', { token: tokens.buyer });
  expect(unread === 0, `${unread} still unread`);
  return `${types.length} notifications, all marked read`;
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

console.log('Loans');
let loan;
await step('Farmer applies with a document', async () => {
  const form = new FormData();
  form.append('amount', '120000');
  form.append('purpose', 'Seeds and fertiliser for the wheat season');
  form.append('durationMonths', '6');
  form.append('documents', new Blob([PDF], { type: 'application/pdf' }), 'land-record.pdf');
  loan = await call('POST', '/loans', { token: tokens.farmer, form });
  expect(loan.status === 'pending' && loan.documentCount === 1, `unexpected ${JSON.stringify(loan)}`);
  await expectStatus(
    call('POST', '/loans', { token: tokens.buyer, form }),
    403,
    'a buyer must not be able to apply',
  );
  return `Rs ${loan.amount} over ${loan.durationMonths} months`;
});
await step('Financial partner reviews the farm and approves', async () => {
  const queue = await call('GET', '/loans?status=pending', { token: tokens.partner });
  const listed = queue.data.find((l) => l.id === loan.id);
  expect(listed?.applicant?.deliveredOrders >= 1, 'applicant sales history missing');
  const detail = await call('GET', `/loans/${loan.id}`, { token: tokens.partner });
  const link = detail.documents?.[0]?.url;
  expect(link, 'no document link');
  const origin = new URL(env.apiUrl).origin;
  const document = await fetch(link.startsWith('http') ? link : `${origin}${link}`);
  expect(document.ok, `document link returned ${document.status}`);
  await call('POST', `/loans/${loan.id}/review`, { token: tokens.partner });
  loan = await call('POST', `/loans/${loan.id}/decision`, {
    token: tokens.partner,
    body: { decision: 'approved' },
  });
  expect(loan.status === 'approved' && loan.repaymentSchedule.length === 6, 'no repayment schedule');
  return `approved, 6 × ~Rs ${loan.repaymentSchedule[0].amount}; applicant has ${listed.applicant.deliveredOrders} delivered order(s)`;
});

console.log('Community');
await step('Farmer posts with a photo; buyer comments', async () => {
  const form = new FormData();
  form.append('title', `Harvest update ${run}`);
  form.append('content', 'Chaunsa is ready this week.');
  form.append('tags', 'mango, harvest');
  form.append('images', new Blob([JPEG], { type: 'image/jpeg' }), 'orchard.jpg');
  const post = await call('POST', '/community/posts', { token: tokens.farmer, form });
  expect(post.author.name === `Smoke Farm ${run}` && post.images.length === 1, 'post author or photo missing');
  await call('POST', `/community/posts/${post.id}/comments`, {
    token: tokens.buyer,
    body: { content: 'Reserving 50 kg!' },
  });
  const feed = await call('GET', '/community/posts?tag=mango', { token: tokens.buyer });
  const listed = feed.data.find((p) => p.id === post.id);
  expect(listed?.commentCount === 1, 'comment count not updated');
  return `post by "${post.author.name}", ${listed.commentCount} comment`;
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

// Leave the throwaway transporters offline so they don't receive real offers.
for (const token of [tokens.driver, tokens.decliner, tokens.farDriver]) {
  await call('PUT', '/shipments/transporter/availability', { token, body: { online: false } }).catch(() => {});
}
await connection.close();
const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skip');
console.log(
  `\n${failed.length ? '✖' : '✔'} ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`,
);
if (skipped.length) console.log('  Skipped steps need the AI service (AI_SERVICE_URL).');
if (product) console.log(`  Open the journey: ${product.qrCode}`);
process.exit(failed.length ? 1 : 0);
