// Pure geometry on WGS84 coordinates (DELIVERY.md §1). GeoJSON order is [lng, lat].

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (/** @type {number} */ d) => (d * Math.PI) / 180;

/**
 * Great-circle distance in whole metres. Used for radius areas and as the configurable FALLBACK only —
 * billing distance is road distance (OD-14).
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 */
export function haversineM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Ray casting. Points exactly on an edge count as inside (a customer on a boundary road is served).
 * @param {number} lng
 * @param {number} lat
 * @param {number[][]} ring closed ring of [lng, lat]
 */
export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (onSegment(lng, lat, xi, yi, xj, yj)) return true;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function onSegment(px, py, ax, ay, bx, by) {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-12) return false;
  return px >= Math.min(ax, bx) - 1e-12 && px <= Math.max(ax, bx) + 1e-12 && py >= Math.min(ay, by) - 1e-12 && py <= Math.max(ay, by) + 1e-12;
}

/**
 * Polygon with optional holes: inside the outer ring and not strictly inside any hole.
 * @param {number} lng
 * @param {number} lat
 * @param {number[][][]} rings
 */
function pointInPolygonRings(lng, lat, rings) {
  const [outer, ...holes] = rings;
  if (!pointInRing(lng, lat, outer)) return false;
  return !holes.some((h) => pointInRing(lng, lat, h) && !ringEdgeContains(lng, lat, h));
}

function ringEdgeContains(lng, lat, ring) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (onSegment(lng, lat, ring[i][0], ring[i][1], ring[j][0], ring[j][1])) return true;
  }
  return false;
}

/**
 * @param {{ lat: number, lng: number }} point
 * @param {{ type: 'Polygon', coordinates: number[][][] } | { type: 'MultiPolygon', coordinates: number[][][][] }} geometry
 */
export function pointInGeometry(point, geometry) {
  if (geometry.type === 'Polygon') return pointInPolygonRings(point.lng, point.lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((poly) => pointInPolygonRings(point.lng, point.lat, poly));
  throw new Error(`Unsupported geometry type ${/** @type {any} */ (geometry).type}`);
}

/**
 * Bounding box used for the indexed SQL pre-filter.
 * @param {{ type: string, coordinates: any }} geometry
 */
export function bboxOf(geometry) {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return { minLat, minLng, maxLat, maxLng };
}
