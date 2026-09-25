#!/usr/bin/env node
// Database design checks (DATABASE.md, DECISIONS D-18). Uses PGlite (PostgreSQL compiled to WASM) so it
// needs no server. Verifies:
//   1. design and active schemas validate; the active schema is up to date with the design
//   2. the committed migration chain produces exactly the active schema + active constraints (no drift)
//   3. the full design + constraints.sql apply to an empty PostgreSQL, and every guarantee rejects bad
//      writes with the EXPECTED SQLSTATE (a typo cannot pass as a success)
//   4. the migrations apply cleanly on their own
//   5. every designed table is classified in docs/DATABASE.md §3
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPkg = path.join(root, 'packages/database');
const env = { ...process.env, DATABASE_URL: 'postgresql://verify@localhost:5432/verify' };
const prisma = (...args) =>
  execFileSync('pnpm', ['exec', 'prisma', ...args], { cwd: dbPkg, env, encoding: 'utf8' });
const read = (rel) => readFile(path.join(dbPkg, rel), 'utf8');

// 1. schemas
prisma('validate', '--schema', 'prisma/design/schema.design.prisma');
prisma('validate', '--schema', 'prisma/schema.prisma');
execFileSync('node', ['scripts/generate-active-schema.mjs', '--check'], { cwd: dbPkg, stdio: 'inherit' });
console.log('✓ design and active schemas validate');

// 2. migrations == generated SQL
const designSql = prisma(
  'migrate',
  'diff',
  '--from-empty',
  '--to-schema-datamodel',
  'prisma/design/schema.design.prisma',
  '--script',
);
const activeSql = prisma(
  'migrate',
  'diff',
  '--from-empty',
  '--to-schema-datamodel',
  'prisma/schema.prisma',
  '--script',
);
const migrationDirs = (await readdir(path.join(dbPkg, 'prisma/migrations'), { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const migrations = await Promise.all(migrationDirs.map((d) => read(`prisma/migrations/${d}/migration.sql`)));
// The migration chain must produce exactly the database the active schema + active constraints describe.
// Compared structurally (columns, types, defaults, nullability, indexes, constraints, enums) so it works
// for any number of migrations (Phase 1 init + constraints, Phase 2 catalog + constraints, …).
{
  const fromMigrations = await PGlite.create();
  const fromSchema = await PGlite.create();
  try {
    for (const sql of migrations) await fromMigrations.exec(sql);
    await fromSchema.exec(activeSql);
    await fromSchema.exec(await read('prisma/constraints.active.sql'));
    const [a, b] = await Promise.all([describe(fromMigrations), describe(fromSchema)]);
    const onlyA = a.filter((x) => !b.includes(x));
    const onlyB = b.filter((x) => !a.includes(x));
    if (onlyA.length || onlyB.length) {
      throw new Error(
        `migrations drift from the active schema:\n  only in migrations: ${onlyA.join('\n    ') || '—'}\n  only in schema: ${onlyB.join('\n    ') || '—'}`,
      );
    }
    console.log(
      `✓ ${migrations.length} migrations produce exactly the active schema + constraints (${a.length} objects)`,
    );
  } finally {
    await fromMigrations.close();
    await fromSchema.close();
  }
}

/** Normalised description of a database's public schema. */
async function describe(db) {
  const q = async (sql) => (await db.query(sql)).rows.map((r) => Object.values(r).join(' | '));
  return [
    ...(await q(`select 'column', table_name, column_name, data_type, udt_name, is_nullable, coalesce(column_default, '')
                 from information_schema.columns where table_schema = 'public'`)),
    ...(await q(
      `select 'index', tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`,
    )),
    ...(await q(`select 'constraint', conrelid::regclass::text, conname, pg_get_constraintdef(oid)
                 from pg_constraint where connamespace = 'public'::regnamespace`)),
    ...(await q(`select 'enum', t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder)
                 from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname`)),
  ].sort();
}

// 3. full design + guarantees
const count = (sql, re) => (sql.match(re) ?? []).length;
console.log(
  `✓ design compiles to ${count(designSql, /^CREATE TABLE/gm)} tables, ${count(designSql, /^CREATE (UNIQUE )?INDEX/gm)} indexes, ${count(designSql, /FOREIGN KEY/g)} foreign keys`,
);
const designDb = await PGlite.create();
try {
  await designDb.exec(designSql);
  await designDb.exec(await read('prisma/constraints.sql'));
  const { rows: v } = await designDb.query('show server_version');
  console.log(`✓ full design + constraints.sql applied to PostgreSQL ${v[0].server_version}`);
  await checkGuarantees(designDb);
} finally {
  await designDb.close();
}

// 4. migrations alone (table count)
const migDb = await PGlite.create();
try {
  for (const sql of migrations) await migDb.exec(sql);
  const { rows } = await migDb.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  console.log(`✓ committed migrations apply cleanly: ${rows[0].n} tables`);
} finally {
  await migDb.close();
}

// 5. classification
const designTables = [...designSql.matchAll(/^CREATE TABLE "(\w+)"/gm)].map((m) => m[1]);
const databaseDoc = await readFile(path.join(root, 'docs/DATABASE.md'), 'utf8');
const section = databaseDoc.slice(
  databaseDoc.indexOf('## 3. Table classification'),
  databaseDoc.indexOf('## 4.'),
);
const unclassified = designTables.filter((t) => !new RegExp(`\\b${t}\\b`).test(section));
if (unclassified.length)
  throw new Error(`Tables missing from docs/DATABASE.md §3: ${unclassified.join(', ')}`);
console.log(`✓ all ${designTables.length} designed tables are classified in docs/DATABASE.md`);

/** Inserts fixtures, then proves each guarantee rejects bad writes with the expected SQLSTATE. */
async function checkGuarantees(db) {
  const id = () => crypto.randomUUID();
  const ids = {
    country: id(),
    state: id(),
    city: id(),
    u1: id(),
    u2: id(),
    u3: id(),
    customer: id(),
    restaurant: id(),
    branch: id(),
    rider1: id(),
    rider2: id(),
    order: id(),
    payment: id(),
  };
  await db.exec(`
    insert into countries (id, code, name) values ('${ids.country}', 'IN', 'India');
    insert into states (id, "countryId", code, name) values ('${ids.state}', '${ids.country}', 'GJ', 'Gujarat');
    insert into cities (id, "stateId", slug, name, "centerLat", "centerLng", "updatedAt") values ('${ids.city}', '${ids.state}', 'unjha', 'Unjha', 23.8053, 72.3935, now());
    insert into users (id, phone, "updatedAt") values ('${ids.u1}', '+919000000001', now()), ('${ids.u2}', '+919000000002', now()), ('${ids.u3}', '+919000000003', now());
    insert into customers (id, "userId", "updatedAt") values ('${ids.customer}', '${ids.u1}', now());
    insert into restaurants (id, "cityId", slug, name, "updatedAt") values ('${ids.restaurant}', '${ids.city}', 'test', 'Test', now());
    insert into restaurant_branches (id, "restaurantId", name, "addressLine", lat, lng, "updatedAt") values ('${ids.branch}', '${ids.restaurant}', 'Main', 'Station Rd', 23.80, 72.39, now());
    insert into riders (id, "userId", "updatedAt") values ('${ids.rider1}', '${ids.u2}', now()), ('${ids.rider2}', '${ids.u3}', now());
    insert into orders (id, "orderNumber", "customerId", "restaurantId", "branchId", "cityId", "paymentMethod", "idempotencyKey", "totalPayablePaise", "codAmountPaise", "itemCount", "updatedAt")
      values ('${ids.order}', 'JZ-TEST-1', '${ids.customer}', '${ids.restaurant}', '${ids.branch}', '${ids.city}', 'COD', 'k1', 47900, 47900, 2, now());
  `);
  const UNIQUE = '23505';
  const CHECK = '23514';
  const rejects = async (label, sql, expected) => {
    try {
      await db.exec(sql);
    } catch (err) {
      if (err.code !== expected)
        throw new Error(`${label}: expected SQLSTATE ${expected}, got ${err.code} (${err.message})`);
      console.log(`  ✓ rejects: ${label} [${expected === UNIQUE ? 'unique' : 'check'}]`);
      return;
    }
    throw new Error(`database ACCEPTED an invalid write: ${label}`);
  };
  const orderInsert = (
    key,
    total,
  ) => `insert into orders (id, "orderNumber", "customerId", "restaurantId", "branchId", "cityId", "paymentMethod", "idempotencyKey", "totalPayablePaise", "itemCount", "updatedAt")
    values ('${id()}', 'JZ-${id().slice(0, 8)}', '${ids.customer}', '${ids.restaurant}', '${ids.branch}', '${ids.city}', 'UPI', '${key}', ${total}, 1, now())`;

  await db.exec(
    `insert into order_assignments (id, "orderId", "riderId", status) values ('${id()}', '${ids.order}', '${ids.rider1}', 'ACCEPTED')`,
  );
  await rejects(
    'second rider accepting the same order',
    `insert into order_assignments (id, "orderId", "riderId", status) values ('${id()}', '${ids.order}', '${ids.rider2}', 'ACCEPTED')`,
    UNIQUE,
  );
  await rejects('duplicate order for the same idempotency key', orderInsert('k1', 100), UNIQUE);
  await rejects(
    'COD amount larger than order total',
    `update orders set "codAmountPaise" = 50000 where id = '${ids.order}'`,
    CHECK,
  );
  await db.exec(
    `insert into payment_events (id, provider, "providerEventId", "eventType", payload, "signatureValid") values ('${id()}', 'razorpay', 'evt_1', 'payment.captured', '{}', true)`,
  );
  await rejects(
    'duplicate payment webhook event',
    `insert into payment_events (id, provider, "providerEventId", "eventType", payload, "signatureValid") values ('${id()}', 'razorpay', 'evt_1', 'payment.captured', '{}', true)`,
    UNIQUE,
  );
  await db.exec(
    `insert into payments (id, "orderId", method, provider, status, "amountPaise", "capturedPaise", "updatedAt") values ('${ids.payment}', '${ids.order}', 'UPI', 'razorpay', 'SUCCEEDED', 47900, 47900, now())`,
  );
  await rejects(
    'second successful payment for one order',
    `insert into payments (id, "orderId", method, provider, status, "amountPaise", "updatedAt") values ('${id()}', '${ids.order}', 'UPI', 'razorpay', 'SUCCEEDED', 47900, now())`,
    UNIQUE,
  );
  await rejects(
    'refunding more than was captured',
    `update payments set "refundedPaise" = 48000 where id = '${ids.payment}'`,
    CHECK,
  );
  await db.exec(
    `insert into refunds (id, "orderId", type, "amountPaise", reason, "idempotencyKey", "actorType") values ('${id()}', '${ids.order}', 'PARTIAL', 5000, 'missing item', 'refund:${ids.order}:1', 'ADMIN')`,
  );
  await rejects(
    'duplicate refund request',
    `insert into refunds (id, "orderId", type, "amountPaise", reason, "idempotencyKey", "actorType") values ('${id()}', '${ids.order}', 'PARTIAL', 5000, 'missing item', 'refund:${ids.order}:1', 'ADMIN')`,
    UNIQUE,
  );
  const ledger = id();
  await db.exec(
    `insert into restaurant_ledgers (id, "restaurantId", "updatedAt") values ('${ledger}', '${ids.restaurant}', now())`,
  );
  const entry = (key, amount, dir = 'CREDIT') =>
    `insert into restaurant_ledger_entries (id, "ledgerId", type, direction, "amountPaise", "balanceAfterPaise", "idempotencyKey") values ('${id()}', '${ledger}', 'FOOD_SALE', '${dir}', ${amount}, 0, '${key}')`;
  await db.exec(entry(`order:${ids.order}:FOOD_SALE`, 40000));
  await rejects('posting the same ledger entry twice', entry(`order:${ids.order}:FOOD_SALE`, 40000), UNIQUE);
  await rejects('negative ledger amount', entry('manual:1', -100, 'DEBIT'), CHECK);
  const settlement = () =>
    `insert into restaurant_settlements (id, "restaurantId", "periodStart", "periodEnd", schedule, "openingPaise", "creditsPaise", "debitsPaise", "netPayablePaise", "updatedAt") values ('${id()}', '${ids.restaurant}', '2026-09-01', '2026-09-07', 'WEEKLY', 0, 40000, 0, 40000, now())`;
  await db.exec(settlement());
  await rejects('duplicate settlement for the same period', settlement(), UNIQUE);
  await db.exec(
    `insert into markup_rules (id, scope, params) values ('${id()}', 'GLOBAL', '{"type":"PERCENTAGE","valueBps":500}')`,
  );
  await rejects(
    'two open versions of the same GLOBAL markup rule',
    `insert into markup_rules (id, scope, params) values ('${id()}', 'GLOBAL', '{"type":"PERCENTAGE","valueBps":700}')`,
    UNIQUE,
  );
  await rejects(
    'coupon with percentage over 100%',
    `insert into coupons (id, code, "discountType", "valueBps", "startsAt", "updatedAt") values ('${id()}', 'BAD', 'PERCENTAGE', 12000, now(), now())`,
    CHECK,
  );
  await db.exec(
    `insert into settings (id, key, scope, value, "updatedAt") values ('${id()}', 'tips', 'GLOBAL', '{}', now())`,
  );
  await rejects(
    'two unscoped (GLOBAL) values for one setting key',
    `insert into settings (id, key, scope, value, "updatedAt") values ('${id()}', 'tips', 'GLOBAL', '{}', now())`,
    UNIQUE,
  );
  await rejects(
    'city-scoped setting without a target',
    `insert into settings (id, key, scope, value, "updatedAt") values ('${id()}', 'tips', 'CITY', '{}', now())`,
    CHECK,
  );
  await rejects(
    'zone with an inverted bounding box',
    `insert into zones (id, "cityId", slug, name, geometry, "minLat", "minLng", "maxLat", "maxLng", "updatedAt") values ('${id()}', '${ids.city}', 'z', 'Z', '{}', 24, 72, 23, 73, now())`,
    CHECK,
  );
  // Phase 2 — restaurants & menus
  await rejects(
    'second primary branch for a restaurant',
    `insert into restaurant_branches (id, "restaurantId", name, "addressLine", lat, lng, "updatedAt") values ('${id()}', '${ids.restaurant}', 'Second', 'Market Rd', 23.80, 72.39, now())`,
    UNIQUE,
  );
  const product = id();
  await db.exec(
    `insert into products (id, "restaurantId", name, "basePricePaise", "updatedAt") values ('${product}', '${ids.restaurant}', 'Thali', 15000, now())`,
  );
  const variant = (name, isDefault) =>
    `insert into product_variants (id, "productId", name, "basePricePaise", "isDefault") values ('${id()}', '${product}', '${name}', 15000, ${isDefault})`;
  await db.exec(variant('Regular', true));
  await rejects('two default variants for one product', variant('Deluxe', true), UNIQUE);
  await rejects(
    'negative product price',
    `update products set "basePricePaise" = -1 where id = '${product}'`,
    CHECK,
  );
  const bank = (primary, verified) =>
    `insert into restaurant_bank_accounts (id, "restaurantId", "accountHolderName", "accountNumberEncrypted", "accountNumberLast4", ifsc, "isPrimary", "verifiedAt", "updatedAt") values ('${id()}', '${ids.restaurant}', 'Test', 'k.x.y.z', '1234', 'HDFC0001234', ${primary}, ${verified ? 'now()' : 'null'}, now())`;
  await rejects('unverified bank account marked primary', bank(true, false), CHECK);
  await db.exec(bank(true, true));
  await rejects('second primary bank account', bank(true, true), UNIQUE);
  await rejects(
    'malformed IFSC',
    `insert into restaurant_bank_accounts (id, "restaurantId", "accountHolderName", "accountNumberEncrypted", "accountNumberLast4", ifsc, "updatedAt") values ('${id()}', '${ids.restaurant}', 'Test', 'k.x.y.z', '1234', 'HDFC1234', now())`,
    CHECK,
  );
  const area = () =>
    `insert into branch_delivery_areas (id, "branchId", kind, "radiusM", "updatedAt") values ('${id()}', '${ids.branch}', 'RADIUS', 3000, now())`;
  await db.exec(area());
  await rejects('second active delivery area for a branch', area(), UNIQUE);
  await rejects(
    'delivery radius below 100 m',
    `insert into branch_delivery_areas (id, "branchId", kind, "radiusM", "isActive", "updatedAt") values ('${id()}', '${ids.branch}', 'RADIUS', 50, false, now())`,
    CHECK,
  );
  const section = (name) =>
    `insert into menu_categories (id, "restaurantId", name, "updatedAt") values ('${id()}', '${ids.restaurant}', '${name}', now())`;
  await db.exec(section('Starters'));
  await rejects('duplicate menu section name (case-insensitive)', section('STARTERS'), UNIQUE);
  await rejects(
    'business hours with an invalid time',
    `insert into restaurant_business_hours (id, "branchId", "dayOfWeek", "opensAt", "closesAt") values ('${id()}', '${ids.branch}', 1, '25:00', '23:00')`,
    CHECK,
  );
  await rejects(
    'sold-out window that ends before it starts',
    `insert into product_availability (id, "productId", "isAvailable", "startsAt", "endsAt") values ('${id()}', '${product}', false, now(), now() - interval '1 hour')`,
    CHECK,
  );
  await rejects(
    'add-on group allowing zero selections at most',
    `insert into product_addon_groups (id, "productId", name, "minSelect", "maxSelect") values ('${id()}', '${product}', 'Extras', 0, 0)`,
    CHECK,
  );
  // Phases 3 + 4 — versioned pricing rules, coupons, promotions
  const taxRule = (appliesTo, extra = '') =>
    `insert into tax_rules (id, scope, params) values ('${id()}', 'GLOBAL', '{"appliesTo":"${appliesTo}","mode":"EXCLUSIVE","components":[]${extra}}')`;
  await db.exec(taxRule('FOOD'));
  await db.exec(taxRule('DELIVERY_FEE')); // a different charge at the same scope is a different target
  await rejects('two open GLOBAL tax rules for the same charge', taxRule('FOOD'), UNIQUE);
  const surge = (kind) =>
    `insert into surge_rules (id, scope, kind, params) values ('${id()}', 'GLOBAL', '${kind}', '{}')`;
  await db.exec(surge('NIGHT'));
  await db.exec(surge('DEMAND'));
  await rejects('two open GLOBAL night surcharge rules', surge('NIGHT'), UNIQUE);
  await rejects(
    'rule version that ends before it starts',
    `insert into delivery_pricing_rules (id, scope, params, "effectiveFrom", "effectiveTo") values ('${id()}', 'GLOBAL', '{}', now(), now() - interval '1 day')`,
    CHECK,
  );
  await rejects(
    'city-scoped rule without a target city',
    `insert into platform_fee_rules (id, scope, params) values ('${id()}', 'CITY', '{}')`,
    CHECK,
  );
  await rejects(
    'lower-case coupon code',
    `insert into coupons (id, code, "discountType", "valuePaise", "startsAt", "updatedAt") values ('${id()}', 'save10', 'FIXED', 1000, now(), now())`,
    CHECK,
  );
  await rejects(
    'promotion with a zero fixed amount',
    `insert into promotions (id, name, "discountType", "valuePaise", "startsAt", "updatedAt") values ('${id()}', 'Bad', 'FIXED', 0, now(), now())`,
    CHECK,
  );
  console.log('✓ database-level guarantees hold');
}
