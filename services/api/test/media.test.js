import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TINY_PNG, adminLogin, adminWithRole, bearer, multipart, startTestApp } from './helpers.js';

let ctx;
let token;
beforeAll(async () => {
  ctx = await startTestApp({ env: { MEDIA_MAX_BYTES: '4096' } });
  token = (await adminLogin(ctx)).accessToken;
});
afterAll(() => ctx?.stop());

const upload = (file, fields = {}, extraHeaders = {}) => {
  const body = multipart(fields, file);
  return ctx.app.inject({ method: 'POST', url: '/v1/admin/media', headers: { ...bearer(token, 'ADMIN', extraHeaders), 'content-type': body.contentType }, payload: body.payload });
};

describe('media library', () => {
  it('stores an image, records an outbox event and an audit entry, and serves the original', async () => {
    const res = await upload({ filename: 'banner.png', contentType: 'image/png', content: TINY_PNG }, { altText: 'Festival banner', tags: 'banner, diwali' });
    expect(res.statusCode).toBe(201);
    const media = res.json();
    expect(media).toMatchObject({ mimeType: 'image/png', sizeBytes: TINY_PNG.length, altText: 'Festival banner', tags: ['banner', 'diwali'], status: 'PENDING' });
    expect(media.urls.original).toBe(`/v1/media/files/media/${media.id}/original.png`);

    const event = await ctx.prisma.outboxEvent.findFirst({ where: { aggregateId: media.id } });
    expect(event).toMatchObject({ eventType: 'media.uploaded', publishedAt: null });
    expect(await ctx.prisma.auditLog.count({ where: { entityId: media.id, action: 'media.upload' } })).toBe(1);

    const file = await ctx.app.inject({ method: 'GET', url: media.urls.original });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.rawPayload.equals(TINY_PNG)).toBe(true);
  });

  it('trusts file content, not the claimed type: text, SVG and oversize files are refused', async () => {
    const txt = await upload({ filename: 'x.png', contentType: 'image/png', content: Buffer.from('not an image at all') });
    expect(txt.statusCode).toBe(415);
    const svg = await upload({ filename: 'x.svg', contentType: 'image/svg+xml', content: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
    expect(svg.statusCode).toBe(415);
    const big = await upload({ filename: 'big.png', contentType: 'image/png', content: Buffer.concat([TINY_PNG, Buffer.alloc(5000)]) });
    expect(big.statusCode).toBe(413);
    expect(await ctx.prisma.media.count({ where: { title: { in: ['x.png', 'x.svg', 'big.png'] } } })).toBe(0);
  });

  it('idempotent upload does not create duplicates', async () => {
    const h = { 'idempotency-key': 'upload-1' };
    const a = await upload({ filename: 'logo.png', contentType: 'image/png', content: TINY_PNG }, {}, h);
    const b = await upload({ filename: 'logo.png', contentType: 'image/png', content: TINY_PNG }, {}, h);
    expect(b.json().id).toBe(a.json().id);
    expect(await ctx.prisma.media.count({ where: { title: 'logo.png' } })).toBe(1);
  });

  it('search, edit alt text, soft delete; deleted files are no longer served', async () => {
    const created = (await upload({ filename: 'thali.png', contentType: 'image/png', content: TINY_PNG }, { title: 'Gujarati thali' })).json();
    const found = await ctx.app.inject({ method: 'GET', url: '/v1/admin/media?q=thali', headers: bearer(token) });
    expect(found.json().items.map((m) => m.id)).toContain(created.id);
    const patched = await ctx.app.inject({ method: 'PATCH', url: `/v1/admin/media/${created.id}`, headers: bearer(token), payload: { altText: 'A Gujarati thali' } });
    expect(patched.json().altText).toBe('A Gujarati thali');
    expect((await ctx.app.inject({ method: 'DELETE', url: `/v1/admin/media/${created.id}`, headers: bearer(token) })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'GET', url: created.urls.original })).statusCode).toBe(404);
    const after = await ctx.app.inject({ method: 'GET', url: '/v1/admin/media?q=thali', headers: bearer(token) });
    expect(after.json().items).toHaveLength(0);
    expect(await ctx.prisma.media.count({ where: { id: created.id } })).toBe(1); // record kept
  });

  it('file paths cannot escape the storage root', async () => {
    for (const url of ['/v1/media/files/../../etc/passwd', '/v1/media/files/media/x/original.png', '/v1/media/files/%2e%2e%2fsecret']) {
      const res = await ctx.app.inject({ method: 'GET', url });
      expect([400, 404]).toContain(res.statusCode); // never served
      expect(res.headers['content-type']).toMatch(/application\/json/);
    }
  });

  it('upload needs media.manage', async () => {
    const support = await adminWithRole(ctx, 'SUPPORT');
    const body = multipart({}, { filename: 'a.png', contentType: 'image/png', content: TINY_PNG });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/admin/media', headers: { ...bearer(support.accessToken), 'content-type': body.contentType }, payload: body.payload });
    expect(res.statusCode).toBe(403);
  });
});
