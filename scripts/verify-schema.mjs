#!/usr/bin/env node
// Phase 0 check: the Prisma schema must (1) validate, (2) compile to SQL, and
// (3) apply cleanly to a real, empty PostgreSQL database. PGlite is Postgres compiled
// to WASM, so no local Postgres/Docker install is required.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPkg = path.join(root, 'packages/database');
const schema = 'prisma/schema.prisma';
const env = { ...process.env, DATABASE_URL: 'postgresql://verify@localhost:5432/verify' };
const prisma = (...args) =>
  execFileSync('pnpm', ['exec', 'prisma', ...args], { cwd: dbPkg, env, encoding: 'utf8' });

prisma('validate', '--schema', schema);
console.log('✓ schema validates');

const sql = prisma('migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script');
const tables = (sql.match(/^CREATE TABLE/gm) ?? []).length;
const indexes = (sql.match(/^CREATE (UNIQUE )?INDEX/gm) ?? []).length;
const fks = (sql.match(/FOREIGN KEY/g) ?? []).length;
console.log(`✓ compiled to SQL: ${tables} tables, ${indexes} indexes, ${fks} foreign keys`);

const db = await PGlite.create();
try {
  await db.exec(sql);
  const { rows } = await db.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
  );
  if (rows[0].n !== tables) throw new Error(`expected ${tables} tables, found ${rows[0].n}`);
  const { rows: v } = await db.query('show server_version');
  console.log(`✓ applied to empty PostgreSQL ${v[0].server_version}: ${rows[0].n} tables present`);

  await db.exec(await readFile(path.join(dbPkg, 'prisma/constraints.sql'), 'utf8'));
  console.log('✓ constraints.sql applied');

  await checkGuarantees(db);
} finally {
  await db.close();
}

/** Inserts minimal fixtures, then proves each database-level guarantee rejects bad writes. */
async function checkGuarantees(db) {
  const id = () => crypto.randomUUID();
  const ids = { country: id(), state: id(), city: id(), u1: id(), u2: id(), u3: id(), customer: id(),
    restaurant: id(), branch: id(), rider1: id(), rider2: id(), order: id(), payment: id() };
  const now = 'now()';
  await db.exec(`
    insert into countries (id, code, name) values ('${ids.country}', 'IN', 'India');
    insert into states (id, "countryId", code, name) values ('${ids.state}', '${ids.country}', 'GJ', 'Gujarat');
    insert into cities (id, "stateId", slug, name, "centerLat", "centerLng", "updatedAt")
      values ('${ids.city}', '${ids.state}', 'unjha', 'Unjha', 23.8053, 72.3935, ${now});
    insert into users (id, phone, "updatedAt") values
      ('${ids.u1}', '+919000000001', ${now}), ('${ids.u2}', '+919000000002', ${now}), ('${ids.u3}', '+919000000003', ${now});
    insert into customers (id, "userId", "updatedAt") values ('${ids.customer}', '${ids.u1}', ${now});
    insert into restaurants (id, "cityId", slug, name, "updatedAt") values ('${ids.restaurant}', '${ids.city}', 'test', 'Test', ${now});
    insert into restaurant_branches (id, "restaurantId", name, "addressLine", lat, lng, "updatedAt")
      values ('${ids.branch}', '${ids.restaurant}', 'Main', 'Station Rd', 23.80, 72.39, ${now});
    insert into riders (id, "userId", "updatedAt") values ('${ids.rider1}', '${ids.u2}', ${now}), ('${ids.rider2}', '${ids.u3}', ${now});
    insert into orders (id, "orderNumber", "customerId", "restaurantId", "branchId", "cityId", "paymentMethod",
      "idempotencyKey", "totalPayablePaise", "codAmountPaise", "itemCount", "updatedAt")
      values ('${ids.order}', 'BM-TEST-1', '${ids.customer}', '${ids.restaurant}', '${ids.branch}', '${ids.city}', 'COD',
      'k1', 47900, 47900, 2, ${now});
  `);

  const UNIQUE = '23505';
  const CHECK = '23514';
  // Must fail with the EXPECTED Postgres error code — a typo/syntax error must not count as a pass.
  const rejects = async (label, sql, expectedCode) => {
    try {
      await db.exec(sql);
    } catch (err) {
      if (err.code !== expectedCode) {
        throw new Error(`${label}: expected SQLSTATE ${expectedCode}, got ${err.code} (${err.message})`);
      }
      console.log(`  ✓ rejects: ${label} [${expectedCode === UNIQUE ? 'unique' : 'check'}]`);
      return;
    }
    throw new Error(`database ACCEPTED an invalid write: ${label}`);
  };

  await db.exec(`insert into order_assignments (id, "orderId", "riderId", status) values ('${id()}', '${ids.order}', '${ids.rider1}', 'ACCEPTED')`);
  await rejects('second rider accepting the same order',
    `insert into order_assignments (id, "orderId", "riderId", status) values ('${id()}', '${ids.order}', '${ids.rider2}', 'ACCEPTED')`, UNIQUE);

  await rejects('duplicate order for the same idempotency key',
    `insert into orders (id, "orderNumber", "customerId", "restaurantId", "branchId", "cityId", "paymentMethod",
      "idempotencyKey", "totalPayablePaise", "itemCount", "updatedAt")
      values ('${id()}', 'BM-TEST-2', '${ids.customer}', '${ids.restaurant}', '${ids.branch}', '${ids.city}', 'UPI', 'k1', 100, 1, now())`, UNIQUE);

  await rejects('COD amount larger than order total',
    `update orders set "codAmountPaise" = 50000 where id = '${ids.order}'`, CHECK);

  await db.exec(`insert into payment_events (id, provider, "providerEventId", "eventType", payload, "signatureValid")
    values ('${id()}', 'razorpay', 'evt_1', 'payment.captured', '{}', true)`);
  await rejects('duplicate payment webhook event',
    `insert into payment_events (id, provider, "providerEventId", "eventType", payload, "signatureValid")
      values ('${id()}', 'razorpay', 'evt_1', 'payment.captured', '{}', true)`, UNIQUE);

  await db.exec(`insert into payments (id, "orderId", method, provider, status, "amountPaise", "capturedPaise", "updatedAt")
    values ('${ids.payment}', '${ids.order}', 'UPI', 'razorpay', 'SUCCEEDED', 47900, 47900, now())`);
  await rejects('second successful payment for one order',
    `insert into payments (id, "orderId", method, provider, status, "amountPaise", "updatedAt")
      values ('${id()}', '${ids.order}', 'UPI', 'razorpay', 'SUCCEEDED', 47900, now())`, UNIQUE);
  await rejects('refunding more than was captured',
    `update payments set "refundedPaise" = 48000 where id = '${ids.payment}'`, CHECK);

  await db.exec(`insert into refunds (id, "orderId", type, "amountPaise", reason, "idempotencyKey", "actorType")
    values ('${id()}', '${ids.order}', 'PARTIAL', 5000, 'missing item', 'refund:${ids.order}:1', 'ADMIN')`);
  await rejects('duplicate refund request',
    `insert into refunds (id, "orderId", type, "amountPaise", reason, "idempotencyKey", "actorType")
      values ('${id()}', '${ids.order}', 'PARTIAL', 5000, 'missing item', 'refund:${ids.order}:1', 'ADMIN')`, UNIQUE);

  const ledger = id();
  await db.exec(`insert into restaurant_ledgers (id, "restaurantId", "updatedAt") values ('${ledger}', '${ids.restaurant}', now())`);
  await db.exec(`insert into restaurant_ledger_entries (id, "ledgerId", type, direction, "amountPaise", "balanceAfterPaise", "idempotencyKey")
    values ('${id()}', '${ledger}', 'FOOD_SALE', 'CREDIT', 40000, 40000, 'order:${ids.order}:FOOD_SALE')`);
  await rejects('posting the same ledger entry twice',
    `insert into restaurant_ledger_entries (id, "ledgerId", type, direction, "amountPaise", "balanceAfterPaise", "idempotencyKey")
      values ('${id()}', '${ledger}', 'FOOD_SALE', 'CREDIT', 40000, 80000, 'order:${ids.order}:FOOD_SALE')`, UNIQUE);
  await rejects('negative/zero ledger amount',
    `insert into restaurant_ledger_entries (id, "ledgerId", type, direction, "amountPaise", "balanceAfterPaise", "idempotencyKey")
      values ('${id()}', '${ledger}', 'MANUAL_DEBIT', 'DEBIT', -100, 40000, 'manual:1')`, CHECK);

  const period = `'2026-09-01', '2026-09-07'`;
  await db.exec(`insert into restaurant_settlements (id, "restaurantId", "periodStart", "periodEnd", schedule, "openingPaise", "creditsPaise", "debitsPaise", "netPayablePaise", "updatedAt")
    values ('${id()}', '${ids.restaurant}', ${period}, 'WEEKLY', 0, 40000, 0, 40000, now())`);
  await rejects('duplicate settlement for the same period',
    `insert into restaurant_settlements (id, "restaurantId", "periodStart", "periodEnd", schedule, "openingPaise", "creditsPaise", "debitsPaise", "netPayablePaise", "updatedAt")
      values ('${id()}', '${ids.restaurant}', ${period}, 'WEEKLY', 0, 40000, 0, 40000, now())`, UNIQUE);

  await db.exec(`insert into markup_rules (id, scope, params) values ('${id()}', 'GLOBAL', '{"type":"PERCENTAGE","valueBps":500}')`);
  await rejects('two open versions of the same GLOBAL markup rule',
    `insert into markup_rules (id, scope, params) values ('${id()}', 'GLOBAL', '{"type":"PERCENTAGE","valueBps":700}')`, UNIQUE);

  await rejects('coupon with percentage over 100%',
    `insert into coupons (id, code, "discountType", "valueBps", "startsAt", "updatedAt") values ('${id()}', 'BAD', 'PERCENTAGE', 12000, now(), now())`, CHECK);

  console.log('✓ database-level guarantees hold');
}
