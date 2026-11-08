#!/usr/bin/env node
// Local Safepay sandbox check. No Docker and no backend build needed.
//
//   node scripts/dev/safepay-sandbox-check.mjs
//       Validates the sandbox keys in .env against the real Safepay sandbox:
//       creates a PKR 100 tracker, gets a passport token, prints a hosted
//       checkout URL you can open and pay with a sandbox test card.
//
//   node scripts/dev/safepay-sandbox-check.mjs --webhook <trackerToken> [--type payment.failed] [--api http://localhost:3000/api]
//       Sends a locally signed webhook to the running backend, to test the
//       callback path before a public tunnel exists. The tracker must belong to
//       a Pending payment (start checkout from the app first).
//
// Secrets are read from .env and never printed.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
const env = { ...process.env };
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in env)) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch {
  console.error(`No .env at ${envPath}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const sandbox = (env.SAFEPAY_ENVIRONMENT ?? 'sandbox') === 'sandbox';
const apiBase = env.SAFEPAY_API_BASE_URL ?? 'https://sandbox.api.getsafepay.com';
const checkoutBase = env.SAFEPAY_CHECKOUT_BASE_URL ?? 'https://sandbox.api.getsafepay.com/embedded';

const need = (name) => {
  if (!env[name]) {
    console.error(`FAIL  ${name} is not set in .env`);
    process.exitCode = 1;
    return false;
  }
  console.log(`ok    ${name} is set`);
  return true;
};

async function webhook(trackerToken) {
  if (!need('SAFEPAY_WEBHOOK_SECRET')) return;
  const type = flag('--type') ?? 'payment.succeeded';
  const api = flag('--api') ?? 'http://localhost:3000/api';
  // Same shape the backend accepts; the real field name is confirmed by the
  // first real sandbox delivery (see extractSafepayTrackerToken).
  const body = JSON.stringify({ type, data: { token: trackerToken } });
  const signature = createHmac('sha512', env.SAFEPAY_WEBHOOK_SECRET).update(body).digest('hex');
  const res = await fetch(`${api}/payments/webhook/safepay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sfpy-signature': signature },
    body,
  });
  console.log(`${res.status} ${await res.text()}`);
  if (!res.ok) process.exitCode = 1;
}

async function post(path, headers, payload) {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => undefined);
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)?.slice(0, 300)}`);
  return json;
}

async function keys() {
  if (!sandbox) {
    console.error('Refusing to run: SAFEPAY_ENVIRONMENT is not sandbox.');
    process.exit(2);
  }
  const ok = [need('SAFEPAY_PUBLIC_KEY'), need('SAFEPAY_SECRET_KEY'), need('SAFEPAY_WEBHOOK_SECRET')];
  if (!ok.every(Boolean)) return;
  try {
    const tracker = (
      await post('/order/payments/v3/', { 'X-SFPY-MERCHANT-SECRET': env.SAFEPAY_SECRET_KEY }, {
        merchant_api_key: env.SAFEPAY_PUBLIC_KEY,
        intent: 'CYBERSOURCE',
        mode: 'payment',
        currency: 'PKR',
        amount: 10000,
        entry_mode: 'raw',
        metadata: { order_id: 'local-sandbox-check' },
      })
    ).data?.tracker;
    if (!tracker?.token) throw new Error('no tracker token in response');
    console.log(`ok    tracker created (state ${tracker.state})`);
    const auth = (
      await post('/client/passport/v1/token', { 'X-SFPY-MERCHANT-SECRET': env.SAFEPAY_SECRET_KEY }, {})
    ).data;
    if (typeof auth !== 'string') throw new Error('no passport token in response');
    console.log('ok    passport token issued (secret key accepted)');
    const url = new URL(`${checkoutBase.replace(/\/+$/, '')}/`);
    for (const [k, v] of Object.entries({
      environment: 'sandbox',
      tracker: tracker.token,
      tbt: auth,
      source: 'hosted',
      redirect_url: env.SAFEPAY_REDIRECT_URL ?? 'http://localhost:3001/order/complete',
      cancel_url: env.SAFEPAY_CANCEL_URL ?? 'http://localhost:3001/order/cancel',
    })) url.searchParams.set(k, v);
    console.log(`\nOpen to pay with a sandbox test card (PKR 100):\n${url}\n`);
    console.log(`Tracker for --webhook: ${tracker.token}  (not tied to an order, so the backend will reject it as unknown)`);
  } catch (error) {
    console.error(`FAIL  ${error.message}`);
    process.exitCode = 1;
  }
}

const token = flag('--webhook');
await (token ? webhook(token) : keys());
