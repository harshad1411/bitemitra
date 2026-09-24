import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@jamzo/database';
import { startTestDatabase } from '@jamzo/database/testing';
import { createLocalStorage, originalKey } from '@jamzo/api/media-storage';
import { createOutboxRelay } from '../src/outbox.js';
import { createMediaUploadedHandler } from '../src/handlers/media.js';

let db;
let prisma;
const log = { warn() {}, error() {}, info() {} };
let offset = 0;
const clock = { now: () => new Date(Date.now() + offset) };

beforeAll(async () => {
  db = await startTestDatabase({ poolSize: 6 });
  prisma = createPrismaClient({ url: db.url });
});
afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});
beforeEach(async () => {
  offset = 0;
  await prisma.outboxEvent.deleteMany();
});

// Events are created clearly due (1 s in the past): an event created in the same millisecond as a claim may
// legitimately be picked up on the next poll instead, which is fine in production but would make tests flaky.
const event = (eventType = 'test.event', extra = {}) =>
  prisma.outboxEvent.create({
    data: { aggregateType: 'TEST', aggregateId: crypto.randomUUID(), eventType, payload: {}, availableAt: new Date(Date.now() - 1000), ...extra },
  });

describe('outbox relay', () => {
  it('runs handlers and marks events published', async () => {
    const seen = [];
    const relay = createOutboxRelay({ prisma, log, clock, workerId: 'w1', handlers: { 'test.event': async (e) => seen.push(e.id) } });
    const a = await event();
    const b = await event();
    expect(await relay.tick()).toEqual({ done: 2, retry: 0, parked: 0 });
    expect(seen).toEqual([a.id, b.id]);
    expect((await prisma.outboxEvent.findUnique({ where: { id: a.id } })).publishedAt).not.toBeNull();
    expect(await relay.tick()).toEqual({ done: 0, retry: 0, parked: 0 });
  });

  it('does not run delayed events early', async () => {
    const relay = createOutboxRelay({ prisma, log, clock, workerId: 'w1', handlers: { 'test.event': async () => {} } });
    await event('test.event', { availableAt: new Date(Date.now() + 60_000) });
    expect((await relay.tick()).done).toBe(0);
    offset = 61_000;
    expect((await relay.tick()).done).toBe(1);
  });

  it('retries with backoff, then parks after max attempts (never silently dropped)', async () => {
    let calls = 0;
    const relay = createOutboxRelay({ prisma, log, clock, workerId: 'w1', maxAttempts: 3, handlers: { 'test.event': async () => { calls++; throw new Error('provider down'); } } });
    const e = await event();
    expect(await relay.tick()).toEqual({ done: 0, retry: 1, parked: 0 });
    let row = await prisma.outboxEvent.findUnique({ where: { id: e.id } });
    expect(row).toMatchObject({ attempts: 1, lastError: 'provider down', failedAt: null, lockedAt: null });
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now() + 4000);
    expect((await relay.tick()).retry).toBe(0); // not due yet
    offset = 6_000;
    expect((await relay.tick()).retry).toBe(1);
    offset = 20_000;
    expect(await relay.tick()).toEqual({ done: 0, retry: 0, parked: 1 });
    row = await prisma.outboxEvent.findUnique({ where: { id: e.id } });
    expect(row.failedAt).not.toBeNull();
    expect(row.publishedAt).toBeNull();
    offset = 10_000_000;
    expect((await relay.tick()).parked).toBe(0); // parked events are not retried automatically
    expect(calls).toBe(3);
  });

  it('unknown event types are retried/parked, not lost', async () => {
    const relay = createOutboxRelay({ prisma, log, clock, workerId: 'w1', maxAttempts: 1, handlers: {} });
    await event('mystery.event');
    expect((await relay.tick()).parked).toBe(1);
    expect((await prisma.outboxEvent.findFirst()).lastError).toMatch(/No handler/);
  });

  it('two workers never process the same event (FOR UPDATE SKIP LOCKED)', async () => {
    const processed = [];
    const slow = async (e) => {
      processed.push(e.id);
      await new Promise((r) => setTimeout(r, 20));
    };
    const w1 = createOutboxRelay({ prisma, log, clock, workerId: 'w1', batchSize: 5, handlers: { 'test.event': slow } });
    const w2 = createOutboxRelay({ prisma, log, clock, workerId: 'w2', batchSize: 5, handlers: { 'test.event': slow } });
    for (let i = 0; i < 20; i++) await event();
    let total = 0;
    for (let round = 0; round < 6; round++) {
      const [a, b] = await Promise.all([w1.tick(), w2.tick()]);
      total += a.done + b.done;
    }
    expect(total).toBe(20);
    expect(processed).toHaveLength(20);
    expect(new Set(processed).size).toBe(20);
  });

  it('reclaims events whose lease expired (crashed worker)', async () => {
    const relay = createOutboxRelay({ prisma, log, clock, workerId: 'w2', leaseSec: 60, handlers: { 'test.event': async () => {} } });
    await event('test.event', { lockedAt: new Date(Date.now() - 30_000), lockedBy: 'dead-worker' });
    expect((await relay.tick()).done).toBe(0); // lease still valid
    offset = 31_000;
    expect((await relay.tick()).done).toBe(1);
  });
});

describe('media.uploaded handler', () => {
  let dir;
  let storage;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'jamzo-worker-media-'));
    storage = createLocalStorage({ root: dir });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const createMedia = async (buffer, ext = 'jpg', mime = 'image/jpeg') => {
    const id = crypto.randomUUID();
    const key = originalKey(id, ext);
    await storage.put(key, buffer);
    return prisma.media.create({ data: { id, storageKey: key, mimeType: mime, sizeBytes: buffer.length } });
  };

  it('generates WebP renditions and marks the media READY', async () => {
    const jpg = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#5B2A86' } }).jpeg().toBuffer();
    const media = await createMedia(jpg);
    const relay = createOutboxRelay({ prisma, log, clock, workerId: 'w', handlers: { 'media.uploaded': createMediaUploadedHandler({ prisma, storage }) } });
    await event('media.uploaded', { payload: { mediaId: media.id } });
    expect((await relay.tick()).done).toBe(1);
    const updated = await prisma.media.findUnique({ where: { id: media.id } });
    expect(updated).toMatchObject({ status: 'READY', width: 1600, height: 900 });
    for (const [name, width] of [['thumb', 200], ['small', 480], ['medium', 960]]) {
      const buf = await storage.get(updated.variants[name]);
      const meta = await sharp(buf).metadata();
      expect([name, meta.format, meta.width]).toEqual([name, 'webp', width]);
    }
  });

  it('small images are not enlarged; unreadable images are marked FAILED and parked', async () => {
    const png = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#fff' } }).png().toBuffer();
    const small = await createMedia(png, 'png', 'image/png');
    const handler = createMediaUploadedHandler({ prisma, storage });
    await handler({ payload: { mediaId: small.id } });
    const s = await prisma.media.findUnique({ where: { id: small.id } });
    expect((await sharp(await storage.get(s.variants.medium)).metadata()).width).toBe(100);

    const broken = await createMedia(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]));
    const relay = createOutboxRelay({ prisma, log, clock, workerId: 'w', maxAttempts: 1, handlers: { 'media.uploaded': handler } });
    await event('media.uploaded', { payload: { mediaId: broken.id } });
    expect((await relay.tick()).parked).toBe(1);
    expect((await prisma.media.findUnique({ where: { id: broken.id } })).status).toBe('FAILED');
  });
});
