#!/usr/bin/env node
// Load test (D-102): starts the real API and worker as separate processes on the database in DATABASE_URL
// (seeded catalog), signs in test customers and the demo delivery partner with the development SMS log, then
// sends a rush-hour mix at a fixed rate (open model: requests are sent on schedule whatever the latency) and
// reports p50 / p95 / p99 per request type against the D-72 target (p95 < 300 ms).
//
//   pnpm load-test                       # 25 req/s for 60 s
//   RATE=100 DURATION=30 pnpm load-test   # stress
//
// Development only (console SMS, fake payments). The numbers depend on the machine: they are not
// DigitalOcean numbers until the same test runs on the staging Droplet.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

const RATE = Number(process.env.RATE ?? 25);
const DURATION = Number(process.env.DURATION ?? 60);
const PORT = Number(process.env.LOAD_PORT ?? 4300);
const BASE = `http://127.0.0.1:${PORT}`;
const HERE = { lat: 23.805, lng: 72.39 };
const TARGET_P95_MS = 300;

// ── Development only: keep every branch open during the test (restaurants close at night), then restore ──
if (['staging', 'production'].includes(process.env.APP_ENV ?? ''))
  throw new Error('The load test runs on development data only');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const savedHours = (await db.query('SELECT * FROM restaurant_business_hours')).rows;
await db.query('BEGIN');
await db.query('DELETE FROM restaurant_business_hours');
await db.query(`INSERT INTO restaurant_business_hours (id, "branchId", "dayOfWeek", "opensAt", "closesAt")
  SELECT gen_random_uuid(), b.id, d, '00:00', '23:59' FROM restaurant_branches b, generate_series(0, 6) d`);
await db.query('COMMIT');
const restoreHours = async () => {
  await db.query('BEGIN');
  await db.query('DELETE FROM restaurant_business_hours');
  for (const h of savedHours)
    await db.query(
      `INSERT INTO restaurant_business_hours (${Object.keys(h)
        .map((k) => `"${k}"`)
        .join(', ')}) VALUES (${Object.keys(h)
        .map((_, i) => `$${i + 1}`)
        .join(', ')})`,
      Object.values(h),
    );
  await db.query('COMMIT');
  await db.end();
};

// ── Start the API and the worker; collect OTPs from the API's development SMS log ──
// Real limits: behind the proxy each phone has its own address (x-forwarded-for), signed-in users their own
// quota. Only sign-in is unlimited here (the test signs in many numbers at once).
const env = {
  ...process.env,
  PORT: String(PORT),
  LOG_LEVEL: 'info',
  TRUST_PROXY: 'true',
  AUTH_RATE_LIMIT_PER_MIN: '100000',
  METRICS_TOKEN: 'load-test-metrics-token-0123456789',
};
const otps = new Map();
const api = spawn(
  process.execPath,
  [
    ...(process.env.API_PROFILE ? ['--cpu-prof', `--cpu-prof-dir=${process.env.API_PROFILE}`] : []),
    '--env-file-if-exists=.env',
    'services/api/src/server.js',
  ],
  {
    env: { ...env, PORT: String(PORT) },
  },
);
const worker = spawn(process.execPath, ['--env-file-if-exists=.env', 'services/workers/src/main.js'], {
  env,
  stdio: 'ignore',
});
let buffered = '';
const onLog = (chunk) => {
  buffered += chunk;
  const lines = buffered.split('\n');
  buffered = lines.pop();
  for (const line of lines) {
    const m = /"to":"\+?(\d+)".*?"devOnlyText":"[^"]*?(\d{6})/.exec(line);
    if (m) otps.set(`+${m[1]}`, m[2]);
  }
};
api.stdout.on('data', onLog);
api.stderr.on('data', onLog);
const stop = () => {
  api.kill('SIGTERM');
  worker.kill('SIGTERM');
};
process.on('exit', stop);

/** Each request comes from a different phone (address), as through the reverse proxy in production. */
const ip = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const headers = (app, token) => ({
  'x-forwarded-for': ip(),
  'x-app-id': app,
  'x-platform': 'ANDROID',
  'x-app-version': '1.0.0',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});
async function call(method, path, app, token, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...headers(app, token), ...(body ? { 'content-type': 'application/json' } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = /** @type {any} */ (await res.json().catch(() => null));
  return { status: res.status, json };
}
async function login(app, phone) {
  otps.delete(phone);
  const r = await call('POST', '/v1/auth/otp/request', app, null, { channel: 'SMS', destination: phone });
  if (r.status !== 200) throw new Error(`OTP request for ${phone}: ${r.status} ${JSON.stringify(r.json)}`);
  for (let i = 0; i < 50 && !otps.has(phone); i++) await sleep(50);
  const v = await call('POST', '/v1/auth/otp/verify', app, null, {
    challengeId: r.json.challengeId,
    code: otps.get(phone),
  });
  if (v.status !== 200) throw new Error(`OTP verify for ${phone}: ${v.status}`);
  return v.json.accessToken;
}

for (let i = 0; i < 100; i++) {
  if ((await fetch(`${BASE}/health`).catch(() => null))?.ok) break;
  await sleep(200);
}
console.log(`API up on ${BASE}; preparing sessions…`);

// ── Setup: customers with an address, the menu, one placed order each; the demo partner online ──
const customers = [];
const run = String(Math.floor(Math.random() * 100000)).padStart(5, '0'); // fresh numbers: OTP limits are per number
for (let i = 0; i < 8; i++) {
  const phone = `+9197${run}${String(i).padStart(3, '0')}`;
  const token = await login('CUSTOMER', phone);
  const addr = await call('POST', '/v1/customer/addresses', 'CUSTOMER', token, {
    label: 'Home',
    line1: 'Load test road',
    ...HERE,
  });
  customers.push({ token, addressId: addr.json.id });
}
const home = await call('GET', `/v1/customer/home?lat=${HERE.lat}&lng=${HERE.lng}`, 'CUSTOMER', null);
const restaurants = (home.json?.sections ?? []).flatMap((s) => s.restaurants ?? []).filter((r) => r?.id);
// Checkout needs an open restaurant; at night none may be open, and then checkout is left out of the mix.
const open = restaurants.find((r) => r.open?.isOpen);
const restaurantId = (open ?? restaurants[0])?.id;
const canCheckout = Boolean(open);
if (!restaurantId)
  throw new Error('No restaurant is serviceable here: seed the catalog (pnpm db:seed) first');
const menu = await call(
  'GET',
  `/v1/customer/restaurants/${restaurantId}?lat=${HERE.lat}&lng=${HERE.lng}`,
  'CUSTOMER',
  null,
);
const product = menu.json.sections
  .flatMap((s) => s.products)
  .find((p) => p.available !== false && !p.variants?.length && !p.addonGroups?.some((g) => g.minSelect > 0));
if (!product) throw new Error('No simple product to order');
const cart = (c) => ({
  restaurantId,
  addressId: c.addressId,
  lines: [{ key: 'a', productId: product.id, quantity: 1 }],
});
const orders = [];
for (const c of canCheckout ? customers : customers.slice(0, 0)) {
  const q = await call('POST', '/v1/customer/cart/quote', 'CUSTOMER', c.token, cart(c));
  const o = await call(
    'POST',
    '/v1/orders',
    'CUSTOMER',
    c.token,
    { ...cart(c), paymentMethod: 'COD', expectedTotalPaise: q.json.bill.totalPayablePaise },
    { 'idempotency-key': randomUUID() },
  );
  if (o.status === 201) orders.push({ token: c.token, id: o.json.order.id });
}
// The demo partner signs in on every run: clear its old codes so the hourly OTP limit does not stop the test.
await db.query(`DELETE FROM otp_challenges WHERE destination = '+919000000002'`);
const rider = await login('RIDER', '+919000000002');
await call('POST', '/v1/rider/status', 'RIDER', rider, { online: true });

// ── The rush-hour mix (weights add to 100) ──
/** @type {[string, number, () => Promise<{ status: number, json: any }>][]} */
const MIX = [
  ['app-config', 8, () => call('GET', '/v1/app-config', 'CUSTOMER', null)],
  ['home', 17, () => call('GET', `/v1/customer/home?lat=${HERE.lat}&lng=${HERE.lng}`, 'CUSTOMER', null)],
  [
    'menu',
    22,
    () =>
      call(
        'GET',
        `/v1/customer/restaurants/${restaurantId}?lat=${HERE.lat}&lng=${HERE.lng}`,
        'CUSTOMER',
        null,
      ),
  ],
  [
    'quote',
    18,
    () => {
      const c = customers[Math.floor(Math.random() * customers.length)];
      return call('POST', '/v1/customer/cart/quote', 'CUSTOMER', c.token, cart(c));
    },
  ],
  [
    'track order',
    orders.length ? 17 : 0,
    () => {
      const o = orders[Math.floor(Math.random() * orders.length)];
      return call('GET', `/v1/customer/orders/${o.id}`, 'CUSTOMER', o.token);
    },
  ],
  [
    'partner location',
    13,
    () =>
      call('POST', '/v1/rider/locations', 'RIDER', rider, {
        points: [
          { lat: HERE.lat + Math.random() / 1000, lng: HERE.lng, recordedAt: new Date().toISOString() },
        ],
      }),
  ],
  [
    'checkout',
    canCheckout ? 5 : 0,
    async () => {
      const c = customers[Math.floor(Math.random() * customers.length)];
      const q = await call('POST', '/v1/customer/cart/quote', 'CUSTOMER', c.token, cart(c));
      return call(
        'POST',
        '/v1/orders',
        'CUSTOMER',
        c.token,
        { ...cart(c), paymentMethod: 'COD', expectedTotalPaise: q.json.bill.totalPayablePaise },
        { 'idempotency-key': randomUUID() },
      );
    },
  ],
];
// SKIP="checkout,partner location" leaves request types out (to find what slows the others down).
for (const name of (process.env.SKIP ?? '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean)) {
  const m = MIX.find((x) => x[0] === name);
  if (m) m[1] = 0;
}
const weightTotal = MIX.reduce((n, m) => n + m[1], 0);
const pick = () => {
  let r = Math.random() * weightTotal;
  for (const m of MIX) if ((r -= m[1]) < 0) return m;
  return MIX[0];
};

console.log(
  `Sending ${RATE} requests/s for ${DURATION} s${canCheckout ? '' : ' (no restaurant open now: checkout left out)'}…`,
);
const samples = new Map(MIX.map(([name]) => [name, []]));
const errors = new Map();
const inflight = [];
const started = performance.now();
for (let i = 0; i < RATE * DURATION; i++) {
  const due = started + (i * 1000) / RATE;
  const wait = due - performance.now();
  if (wait > 0) await sleep(wait);
  const [name, , run] = pick();
  const t0 = performance.now();
  inflight.push(
    run()
      .then((r) => {
        samples.get(name).push(performance.now() - t0);
        if (r.status >= 400) errors.set(`${name} ${r.status}`, (errors.get(`${name} ${r.status}`) ?? 0) + 1);
      })
      .catch((e) =>
        errors.set(`${name} ${e.code ?? e.message}`, (errors.get(`${name} ${e.code ?? e.message}`) ?? 0) + 1),
      ),
  );
}
await Promise.all(inflight);
const seconds = (performance.now() - started) / 1000;

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]);
};
const all = [...samples.values()].flat();
const rows = [...samples.entries()].map(([name, xs]) => ({
  name,
  n: xs.length,
  p50: pct(xs, 50),
  p95: pct(xs, 95),
  p99: pct(xs, 99),
}));
rows.push({ name: 'ALL', n: all.length, p50: pct(all, 50), p95: pct(all, 95), p99: pct(all, 99) });
console.log(
  `\nAchieved ${(all.length / seconds).toFixed(1)} req/s over ${seconds.toFixed(0)} s (target ${RATE}/s).`,
);
console.log('request type        count   p50 ms  p95 ms  p99 ms');
for (const r of rows)
  console.log(
    `${r.name.padEnd(18)} ${String(r.n).padStart(6)} ${String(r.p50).padStart(8)} ${String(r.p95).padStart(7)} ${String(r.p99).padStart(7)}`,
  );
console.log(errors.size ? `Errors: ${JSON.stringify(Object.fromEntries(errors))}` : 'Errors: none');
const overall = rows.at(-1).p95;
console.log(
  overall <= TARGET_P95_MS
    ? `✓ p95 ${overall} ms ≤ ${TARGET_P95_MS} ms (D-72) on this machine`
    : `✗ p95 ${overall} ms > ${TARGET_P95_MS} ms (D-72)`,
);
// What the API itself measured (server side, without the network and this process): share of requests ≤ 300 ms.
const metricsText = await fetch(`${BASE}/metrics`, {
  headers: { authorization: 'Bearer load-test-metrics-token-0123456789' },
}).then((r) => r.text());
let fast = 0;
let total = 0;
for (const line of metricsText.split('\n')) {
  const b = /^jamzo_http_request_duration_ms_bucket\{route="([^"]+)",le="([^"]+)"\} (\d+)/.exec(line);
  if (!b || ['/health', '/metrics'].includes(b[1])) continue;
  if (b[2] === '300') fast += Number(b[3]);
  if (b[2] === '+Inf') total += Number(b[3]);
}
console.log(
  `Server side: ${((fast / total) * 100).toFixed(1)}% of ${total} requests took ≤ 300 ms inside the API.`,
);
await call('POST', '/v1/rider/status', 'RIDER', rider, { online: false });
await restoreHours();
stop();
process.exit(overall <= TARGET_P95_MS && !errors.size ? 0 : 1);
