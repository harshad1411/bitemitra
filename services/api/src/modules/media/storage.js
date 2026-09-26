// Storage interface (ARCHITECTURE §6, DECISIONS D-23, D-98): the local-filesystem driver for development and
// tests, and an S3-compatible driver for DigitalOcean Spaces in staging/production.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import path from 'node:path';

/**
 * @typedef {object} Storage
 * @property {string} name
 * @property {(key: string, body: Buffer, contentType: string) => Promise<void>} put
 * @property {(key: string) => Promise<Buffer | null>} get
 * @property {(key: string) => Promise<void>} remove
 */

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,300}$/;

/** @param {string} key */
export function assertSafeKey(key) {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//'))
    throw new Error(`Unsafe storage key: ${key}`);
  return key;
}

/**
 * @param {{ root: string }} options absolute or process-relative directory
 * @returns {Storage}
 */
export function createLocalStorage({ root }) {
  const base = path.resolve(root);
  const full = (key) => {
    const p = path.resolve(base, assertSafeKey(key));
    if (!p.startsWith(base + path.sep)) throw new Error('Storage key escapes the storage root');
    return p;
  };
  return {
    name: 'local',
    async put(key, body) {
      const p = full(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async get(key) {
      try {
        return await readFile(full(key));
      } catch (err) {
        if (/** @type {any} */ (err).code === 'ENOENT') return null;
        throw err;
      }
    },
    async remove(key) {
      await rm(full(key), { force: true });
    },
  };
}

/**
 * DigitalOcean Spaces (S3-compatible, D-98). Library images are public-read so the Spaces CDN can serve them
 * directly; anything under `private/` (KYC and rider documents) stays private and is read only via the API.
 * @param {{ endpoint: string, bucket: string, key: string, secret: string, region?: string, forcePathStyle?: boolean }} o
 * @returns {Storage}
 */
export function createSpacesStorage({
  endpoint,
  bucket,
  key,
  secret,
  region = 'us-east-1',
  forcePathStyle = false,
}) {
  const s3 = new S3Client({
    endpoint,
    region, // Spaces ignores the region; the SDK requires one
    forcePathStyle,
    credentials: { accessKeyId: key, secretAccessKey: secret },
  });
  return {
    name: 'spaces',
    async put(objectKey, body, contentType) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: assertSafeKey(objectKey),
          Body: body,
          ContentType: contentType,
          ACL: objectKey.startsWith('private/') ? 'private' : 'public-read',
          CacheControl: objectKey.startsWith('private/')
            ? 'private, no-store'
            : 'public, max-age=31536000, immutable',
        }),
      );
    },
    async get(objectKey) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: assertSafeKey(objectKey) }));
        return Buffer.from(await r.Body.transformToByteArray());
      } catch (err) {
        const e = /** @type {any} */ (err);
        if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
    async remove(objectKey) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: assertSafeKey(objectKey) }));
    },
  };
}

/** @param {any} env */
export function createStorage(env) {
  if (env.MEDIA_STORAGE_DRIVER === 'local') return createLocalStorage({ root: env.MEDIA_LOCAL_DIR });
  if (env.MEDIA_STORAGE_DRIVER === 'spaces')
    return createSpacesStorage({
      endpoint: env.SPACES_ENDPOINT,
      bucket: env.SPACES_BUCKET,
      key: env.SPACES_KEY,
      secret: env.SPACES_SECRET,
    });
  throw new Error(`Storage driver "${env.MEDIA_STORAGE_DRIVER}" is not implemented (DECISIONS D-23)`);
}

/**
 * Detects the real image type from magic bytes — the client's claimed MIME type is never trusted.
 * SVG is deliberately unsupported (script injection risk).
 * @param {Buffer} buf
 * @returns {{ mime: string, ext: string } | null}
 */
export function sniffImage(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { mime: 'image/jpeg', ext: 'jpg' };
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return { mime: 'image/png', ext: 'png' };
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/**
 * Document types accepted for restaurant KYC (D-36): PDF, JPEG, PNG — detected from content.
 * @param {Buffer} buf
 * @returns {{ mime: string, ext: string } | null}
 */
export function sniffDocument(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-')
    return { mime: 'application/pdf', ext: 'pdf' };
  const image = sniffImage(buf);
  return image && image.ext !== 'webp' ? image : null;
}

export const RENDITIONS = Object.freeze({ thumb: 200, small: 480, medium: 960 });
export const originalKey = (id, ext) => `media/${id}/original.${ext}`;
export const renditionKey = (id, size) => `media/${id}/${size}.webp`;
/** Private documents never live under media/ (the public route only serves media/ keys — D-36). */
export const documentKey = (id, ext) => `private/documents/${id}/original.${ext}`;
