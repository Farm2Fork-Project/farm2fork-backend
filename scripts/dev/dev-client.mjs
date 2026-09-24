// Shared helpers for local-only dev tooling (seed + smoke). These scripts
// create users directly in MongoDB and sign backend JWTs with JWT_SECRET, so
// they must never run against production data.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mongoose = require('mongoose');
// jsonwebtoken is the signer @nestjs/jwt uses; resolve it from there.
const jwt = require(require.resolve('jsonwebtoken', { paths: [require.resolve('@nestjs/jwt')] }));

export function requireLocalEnv() {
  const env = {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    apiUrl: (process.env.API_URL ?? 'http://localhost:3002/api').replace(/\/+$/, ''),
  };
  const missing = Object.entries({ DATABASE_URL: env.databaseUrl, JWT_SECRET: env.jwtSecret })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) fail(`Missing ${missing.join(', ')} (use the same values as the API).`);
  if (process.env.NODE_ENV === 'production') fail('Refusing to run with NODE_ENV=production.');
  const remote = /mongodb\+srv:|mongodb\.net/.test(env.databaseUrl);
  if (remote && !process.argv.includes('--allow-remote')) {
    fail('DATABASE_URL points at a hosted cluster. Re-run with --allow-remote only if it is a disposable dev database.');
  }
  return env;
}

export function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

export async function connect(databaseUrl) {
  return mongoose.createConnection(databaseUrl, { serverSelectionTimeoutMS: 8000 }).asPromise();
}

/** Creates (or reuses) an active, verified user with an optional profile. */
export async function ensureUser(db, { email, role, profile }) {
  const users = db.collection('users');
  let user = await users.findOne({ email });
  if (!user) {
    const now = new Date();
    const { insertedId } = await users.insertOne({
      email,
      role,
      isVerified: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    user = { _id: insertedId, email, role };
  }
  if (profile) {
    const collection = `${role}_profiles`;
    await db.collection(collection).updateOne(
      { userId: user._id },
      { $setOnInsert: { userId: user._id, ...profile } },
      { upsert: true },
    );
  }
  return user;
}

export function tokenFor(user, secret) {
  return jwt.sign({ sub: user._id.toHexString(), email: user.email, role: user.role }, secret, {
    expiresIn: '2h',
  });
}

export function apiClient(apiUrl) {
  return async function call(method, path, { token, body, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const error = new Error(`${method} ${path} → ${response.status} ${JSON.stringify(data)}`);
      error.status = response.status;
      throw error;
    }
    return data;
  };
}
