// Public URLs for library images (never for documents — those are private, DECISIONS D-36).

/**
 * @param {{ storageKey: string, variants?: any }} media
 * @param {string} base MEDIA_PUBLIC_BASE_URL without a trailing slash
 * @returns {Record<string, string>}
 */
export function mediaUrls(media, base) {
  return {
    original: `${base}/${media.storageKey}`,
    ...Object.fromEntries(
      Object.entries(/** @type {Record<string, string>} */ (media.variants ?? {})).map(([k, v]) => [
        k,
        `${base}/${v}`,
      ]),
    ),
  };
}

/** @param {{ MEDIA_PUBLIC_BASE_URL: string }} env */
export const mediaBase = (env) => env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, '');
