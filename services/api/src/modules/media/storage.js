// Storage interface (ARCHITECTURE §6, DECISIONS D-23). Phase 1 implements ONLY the local-filesystem
// driver (development/test). An S3-compatible driver is required before production and is not built yet.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

/** @param {{ MEDIA_STORAGE_DRIVER: string, MEDIA_LOCAL_DIR: string }} env */
export function createStorage(env) {
  if (env.MEDIA_STORAGE_DRIVER === 'local') return createLocalStorage({ root: env.MEDIA_LOCAL_DIR });
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
