#!/usr/bin/env node
// Seeds a demo marketplace for local testing: two demo farms and their
// listings, created through the real POST /products (so each listing gets
// its `listed` ledger event and QR trace URL exactly as in production).
//
//   pnpm seed:demo            # idempotent: skips listings that already exist
//
// Demo farmers cannot sign in (they have no Firebase account); sign up your
// own farmer/buyer/transporter accounts in the apps to test those roles.
import { apiClient, connect, ensureUser, fail, requireLocalEnv, tokenFor } from './dev-client.mjs';

const FARMS = [
  {
    email: 'demo.farmer.multan@farm2fork.test',
    profile: {
      farmName: 'Green Valley Farm (demo)',
      cnic: 'DEMO-00000-0000001',
      farmLocation: { address: 'Chak 5, Canal Road', city: 'Multan', province: 'Punjab', lat: 30.1968, lng: 71.4782 },
      cropTypes: ['mango', 'wheat'],
      certifications: [],
    },
    products: [
      { name: 'Chaunsa Mangoes', category: 'fruits', price: 320, quantity: 400, unit: 'kg', qualityGrade: 'A', description: 'Hand-picked, naturally ripened.' },
      { name: 'Sindhri Mangoes', category: 'fruits', price: 280, quantity: 250, unit: 'kg', qualityGrade: 'B' },
      { name: 'Wheat (Gandum)', category: 'grains', price: 95, quantity: 5000, unit: 'kg', qualityGrade: 'A' },
      { name: 'Desi Tomatoes', category: 'vegetables', price: 140, quantity: 300, unit: 'kg', qualityGrade: 'B' },
    ],
  },
  {
    email: 'demo.farmer.sheikhupura@farm2fork.test',
    profile: {
      farmName: 'Ravi Fields (demo)',
      cnic: 'DEMO-00000-0000002',
      farmLocation: { address: 'Village Kot Pindi Das', city: 'Sheikhupura', province: 'Punjab', lat: 31.7167, lng: 73.9850 },
      cropTypes: ['rice', 'maize'],
      certifications: [],
    },
    products: [
      { name: 'Basmati Rice (Super Kernel)', category: 'grains', price: 410, quantity: 1200, unit: 'kg', qualityGrade: 'A' },
      { name: 'Maize (Makai)', category: 'grains', price: 72, quantity: 2000, unit: 'kg', qualityGrade: 'B' },
      { name: 'Fresh Buffalo Milk', category: 'dairy', price: 220, quantity: 80, unit: 'litre', qualityGrade: 'A' },
      { name: 'Spinach (Palak)', category: 'vegetables', price: 90, quantity: 150, unit: 'kg', qualityGrade: 'A' },
    ],
  },
];

const env = requireLocalEnv();
const call = apiClient(env.apiUrl);
const connection = await connect(env.databaseUrl).catch((e) => fail(`MongoDB: ${e.message}`));
await call('GET', '/health').catch((e) => fail(`API not reachable at ${env.apiUrl}: ${e.message}`));

let created = 0;
let skipped = 0;
for (const farm of FARMS) {
  const farmer = await ensureUser(connection.db, { email: farm.email, role: 'farmer', profile: farm.profile });
  // Demo farms always carry a map pin (delivery pricing needs it), also when
  // they were seeded before pins existed.
  await connection.db
    .collection('farmer_profiles')
    .updateOne({ userId: farmer._id }, { $set: { farmLocation: farm.profile.farmLocation } });
  const token = tokenFor(farmer, env.jwtSecret);
  const existing = await call('GET', '/products/mine?limit=100', { token });
  const names = new Set(existing.data.map((p) => p.name));
  for (const product of farm.products) {
    if (names.has(product.name)) {
      skipped += 1;
      continue;
    }
    await call('POST', '/products', { token, body: product });
    created += 1;
  }
  console.log(`✔ ${farm.profile.farmName}: ${farm.products.length} listings`);
}
await connection.close();
console.log(`\nDone: ${created} created, ${skipped} already present.`);
console.log('Listings start with ledger state "pending" until the Fabric worker confirms them (see TESTING.md).');
