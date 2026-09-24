// media.uploaded → generate WebP renditions (spec §62: never send giant originals to every screen).
// Idempotent: re-running overwrites the same keys and sets the same fields.
import sharp from 'sharp';
import { RENDITIONS, renditionKey } from '@jamzo/api/media-storage';

/**
 * @param {{ prisma: import('@jamzo/database').Db, storage: import('@jamzo/api/media-storage').Storage }} deps
 */
export function createMediaUploadedHandler({ prisma, storage }) {
  return async function onMediaUploaded(event) {
    const media = await prisma.media.findUnique({ where: { id: event.payload.mediaId } });
    if (!media || media.deletedAt) return; // nothing to do — not an error
    const original = await storage.get(media.storageKey);
    if (!original) throw new Error(`Original file missing for media ${media.id}`);
    let meta;
    try {
      meta = await sharp(original).metadata();
    } catch (err) {
      await prisma.media.update({ where: { id: media.id }, data: { status: 'FAILED' } });
      throw new Error(`Unreadable image ${media.id}: ${/** @type {any} */ (err).message}`);
    }
    const variants = {};
    for (const [name, width] of Object.entries(RENDITIONS)) {
      const out = await sharp(original)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const key = renditionKey(media.id, name);
      await storage.put(key, out, 'image/webp');
      variants[name] = key;
    }
    await prisma.media.update({
      where: { id: media.id },
      data: { variants, width: meta.width ?? null, height: meta.height ?? null, status: 'READY' },
    });
  };
}
