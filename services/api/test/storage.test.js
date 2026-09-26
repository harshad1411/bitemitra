// The Spaces storage driver (D-98) against a fake S3 server speaking the real protocol (path-style). Not
// verified with DigitalOcean until the owner creates the Space and its keys.
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpacesStorage } from '../src/modules/media/storage.js';

const objects = new Map();
const seen = [];
let server;
let endpoint;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const key = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      seen.push({ method: req.method, key, headers: req.headers });
      if (req.method === 'PUT') {
        objects.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] });
        res.writeHead(200, { etag: '"1"' }).end();
      } else if (req.method === 'GET') {
        const o = objects.get(key);
        if (!o)
          return res
            .writeHead(404, { 'content-type': 'application/xml' })
            .end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>');
        res.writeHead(200, { 'content-type': o.type, 'content-length': o.body.length }).end(o.body);
      } else if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204).end();
      } else res.writeHead(405).end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe('Spaces storage', () => {
  it('public images are public-read with a long cache; private documents stay private', async () => {
    const s = createSpacesStorage({
      endpoint,
      bucket: 'jamzo-media',
      key: 'DO00TESTKEY',
      secret: 'test-secret-value',
      forcePathStyle: true,
    });
    await s.put('media/abc/400.webp', Buffer.from('image-bytes'), 'image/webp');
    await s.put('private/documents/doc1/original.pdf', Buffer.from('%PDF'), 'application/pdf');
    const [img, doc] = seen.filter((r) => r.method === 'PUT');
    expect(img.key).toBe('/jamzo-media/media/abc/400.webp');
    expect(img.headers).toMatchObject({
      'x-amz-acl': 'public-read',
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=31536000, immutable',
    });
    expect(img.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=DO00TESTKEY\//); // signed requests
    expect(doc.headers).toMatchObject({ 'x-amz-acl': 'private', 'cache-control': 'private, no-store' });

    expect((await s.get('media/abc/400.webp')).toString()).toBe('image-bytes');
    expect(await s.get('media/missing.webp')).toBeNull();
    await s.remove('media/abc/400.webp');
    expect(await s.get('media/abc/400.webp')).toBeNull();
    await expect(s.put('../escape', Buffer.from('x'), 'text/plain')).rejects.toThrow(/Unsafe storage key/);
  });
});
