// Address search and the address of a map spot (D-114). With the Jamzo Admin setting maps.provider = GOOGLE
// and a server key, answers come from Google (Places API (New) and the Geocoding API); otherwise — or when
// Google fails — from Jamzo's own zones and service areas, so customers can always place the pin. The key
// comes only from the server environment and is never sent to the apps. Tested against fake endpoints only;
// not verified with Google until the key exists.

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places/';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const BIAS_RADIUS_M = 30_000;

/** @typedef {{ id: string, title: string, subtitle: string | null, lat: number | null, lng: number | null }} PlaceSuggestion */
/** @typedef {{ title: string, line: string, area: string | null, city: string | null, pincode: string | null }} SpotAddress */

const num = (d) => (d == null ? null : Number(d));
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Rough middle of a GeoJSON Polygon / MultiPolygon (average of the outer ring), good enough to move a map. */
export function middleOf(geometry) {
  const ring =
    geometry?.type === 'Polygon'
      ? geometry.coordinates?.[0]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates?.[0]?.[0]
        : null;
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const pts = ring.slice(0, -1);
  return {
    lat: round6(pts.reduce((n, p) => n + p[1], 0) / pts.length),
    lng: round6(pts.reduce((n, p) => n + p[0], 0) / pts.length),
  };
}

/** Area, city and pincode out of Google address components (Geocoding or Places field names). */
function fromComponents(components = []) {
  const pick = (...types) => {
    for (const t of types) {
      const c = components.find((x) => x.types?.includes(t));
      if (c) return c.long_name ?? c.longText ?? null;
    }
    return null;
  };
  return {
    area: pick('sublocality_level_1', 'sublocality', 'neighborhood', 'locality'),
    city: pick('locality', 'administrative_area_level_3', 'administrative_area_level_2'),
    pincode: pick('postal_code'),
  };
}

/** "Station Rd, Unjha, Gujarat 384170, India" → "Station Rd, Unjha" (the state, pincode and country add nothing). */
function shortLine(formatted, parts) {
  const cut = String(formatted ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'India' && !/^[A-Za-z .]+ \d{6}$/.test(s) && !/^\d{6}$/.test(s));
  const line = cut.join(', ');
  return line || [parts.area, parts.city].filter(Boolean).join(', ');
}

/** First part of a line, with the next part when the first is only a house number ("12, Station Rd"). */
function titleOf(line) {
  const [a, b] = line.split(',').map((x) => x.trim());
  return /^[\d\s/-]+$/.test(a ?? '') && b ? `${a}, ${b}` : a;
}

/**
 * @param {{ prisma: any, apiKey?: string | null, getProvider?: () => Promise<'NONE' | 'GOOGLE'>,
 *   fetch?: typeof fetch, timeoutMs?: number, cacheTtlMs?: number, now?: () => number, log?: { warn: Function } }} options
 */
export function createPlaces(options) {
  const {
    prisma,
    apiKey = null,
    getProvider = async () => 'NONE',
    fetch: doFetch = globalThis.fetch,
    timeoutMs = 2500,
    cacheTtlMs = 24 * 3_600_000,
    now = Date.now,
    log,
  } = options;
  /** @type {Map<string, { value: SpotAddress | null, until: number }>} */
  const reverseCache = new Map();
  const useGoogle = async () => Boolean(apiKey) && (await getProvider()) === 'GOOGLE';

  async function googleJson(url, init = {}) {
    const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`maps provider answered ${res.status}`);
    return /** @type {any} */ (await res.json());
  }
  const warn = (err, what) =>
    log?.warn({ err: String(err?.message ?? err) }, `${what} from Google unavailable, using Jamzo areas`);

  // ── Jamzo's own areas (no Google) ──
  async function localSearch(q) {
    const where = { isActive: true, name: { contains: q, mode: 'insensitive' } };
    const [areas, zones] = await Promise.all([
      prisma.serviceArea.findMany({
        where: { ...where, zone: { isActive: true, city: { isActive: true } } },
        include: { zone: { include: { city: true } } },
        take: 10,
        orderBy: { name: 'asc' },
      }),
      prisma.zone.findMany({
        where: { ...where, city: { isActive: true } },
        include: { city: true },
        take: 10,
        orderBy: { name: 'asc' },
      }),
    ]);
    /** @type {PlaceSuggestion[]} */
    const out = [];
    for (const a of areas) {
      const at =
        a.kind === 'RADIUS' && a.centerLat != null
          ? { lat: num(a.centerLat), lng: num(a.centerLng) }
          : middleOf(a.geometry);
      if (at)
        out.push({
          id: `area:${a.id}`,
          title: a.name,
          subtitle: `${a.zone.name}, ${a.zone.city.name}`,
          ...at,
        });
    }
    for (const z of zones) {
      const at = middleOf(z.geometry) ?? {
        lat: round6((num(z.minLat) + num(z.maxLat)) / 2),
        lng: round6((num(z.minLng) + num(z.maxLng)) / 2),
      };
      out.push({ id: `zone:${z.id}`, title: z.name, subtitle: z.city.name, ...at });
    }
    return out.slice(0, 10);
  }

  /** @param {{ zone: any, city: any, serviceAreaId: string | null }} spot */
  async function localAddress(spot) {
    if (!spot.zone) return null;
    const area = spot.serviceAreaId
      ? await prisma.serviceArea.findUnique({ where: { id: spot.serviceAreaId }, select: { name: true } })
      : null;
    const areaName = area?.name ?? spot.zone.name;
    const city = spot.city?.name ?? null;
    return {
      title: areaName,
      line: [areaName, city].filter((x, i, xs) => x && xs.indexOf(x) === i).join(', '),
      area: areaName,
      city,
      pincode: null,
    };
  }

  // ── Google ──
  async function googleSearch(q, near, session) {
    const body = {
      input: q,
      includedRegionCodes: ['in'],
      languageCode: 'en',
      ...(session ? { sessionToken: session } : {}),
      ...(near
        ? {
            locationBias: {
              circle: { center: { latitude: near.lat, longitude: near.lng }, radius: BIAS_RADIUS_M },
            },
          }
        : {}),
    };
    const res = await googleJson(AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': /** @type {string} */ (apiKey) },
      body: JSON.stringify(body),
    });
    return (res.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p) => p?.placeId)
      .slice(0, 8)
      .map((p) => ({
        id: `g:${p.placeId}`,
        title: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        subtitle: p.structuredFormat?.secondaryText?.text ?? null,
        lat: null,
        lng: null,
      }));
  }

  return {
    /**
     * @param {string} q
     * @param {{ lat: number, lng: number } | null} near
     * @param {string | null} session
     * @returns {Promise<{ source: 'GOOGLE' | 'LOCAL', items: PlaceSuggestion[] }>}
     */
    async search(q, near, session) {
      if (await useGoogle()) {
        try {
          return { source: 'GOOGLE', items: await googleSearch(q, near, session) };
        } catch (err) {
          warn(err, 'search');
        }
      }
      return { source: 'LOCAL', items: await localSearch(q) };
    },

    /**
     * Position and address of a search result. Jamzo areas already carry their position.
     * @returns {Promise<{ lat: number, lng: number, title: string, address: SpotAddress | null } | null>}
     */
    async details(id, session) {
      const [kind, ref] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
      if (kind === 'g') {
        if (!(await useGoogle())) return null;
        const qs = new URLSearchParams({ languageCode: 'en', ...(session ? { sessionToken: session } : {}) });
        const p = await googleJson(`${DETAILS_URL}${encodeURIComponent(ref)}?${qs}`, {
          headers: {
            'x-goog-api-key': /** @type {string} */ (apiKey),
            'x-goog-fieldmask': 'id,displayName,formattedAddress,location,addressComponents',
          },
        });
        if (!Number.isFinite(p?.location?.latitude)) return null;
        const parts = fromComponents(p.addressComponents);
        return {
          lat: round6(p.location.latitude),
          lng: round6(p.location.longitude),
          title: p.displayName?.text ?? parts.area ?? '',
          address: { title: p.displayName?.text ?? '', line: shortLine(p.formattedAddress, parts), ...parts },
        };
      }
      const row =
        kind === 'area'
          ? await prisma.serviceArea.findFirst({ where: { id: ref, isActive: true } })
          : kind === 'zone'
            ? await prisma.zone.findFirst({ where: { id: ref, isActive: true } })
            : null;
      if (!row) return null;
      const at =
        row.kind === 'RADIUS' && row.centerLat != null
          ? { lat: num(row.centerLat), lng: num(row.centerLng) }
          : middleOf(row.geometry);
      return at ? { ...at, title: row.name, address: null } : null;
    },

    /**
     * Address of a map spot. `spot` is the serviceability answer for the same point (zone, city, area).
     * @returns {Promise<{ source: 'GOOGLE' | 'LOCAL', address: SpotAddress | null }>}
     */
    async reverse(point, spot) {
      if (await useGoogle()) {
        const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
        const hit = reverseCache.get(key);
        if (hit && hit.until > now()) return { source: 'GOOGLE', address: hit.value };
        try {
          const qs = new URLSearchParams({
            latlng: `${point.lat},${point.lng}`,
            language: 'en',
            region: 'in',
            key: /** @type {string} */ (apiKey),
          });
          const res = await googleJson(`${GEOCODE_URL}?${qs}`);
          if (res.status !== 'OK' && res.status !== 'ZERO_RESULTS')
            throw new Error(`geocoding ${res.status}`);
          const best = (res.results ?? []).find((r) => !r.types?.includes('plus_code')) ?? null;
          let value = null;
          if (best) {
            const parts = fromComponents(best.address_components);
            const line = shortLine(best.formatted_address, parts);
            value = { title: titleOf(line) || parts.area || '', line, ...parts };
          }
          if (reverseCache.size >= 5000) reverseCache.delete(reverseCache.keys().next().value);
          reverseCache.set(key, { value, until: now() + cacheTtlMs });
          return { source: 'GOOGLE', address: value };
        } catch (err) {
          warn(err, 'address');
        }
      }
      return { source: 'LOCAL', address: await localAddress(spot) };
    },
  };
}
