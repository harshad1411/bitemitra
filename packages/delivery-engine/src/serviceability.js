// Serviceability decision (DELIVERY.md §1). Pure: callers load candidate rows (bbox pre-filtered).
import { haversineM, pointInGeometry } from './geo.js';

/**
 * @typedef {{ id: string, name: string, slug: string, isActive: boolean }} CityRef
 * @typedef {{ id: string, name: string, slug: string, cityId: string, isActive: boolean, geometry: any }} ZoneRef
 * @typedef {{ id: string, zoneId: string, kind: 'POLYGON' | 'RADIUS', geometry?: any, centerLat?: number, centerLng?: number, radiusM?: number, isActive: boolean }} ServiceAreaRef
 */

/**
 * A point is serviceable when it lies in an active zone of a live city and — if that zone defines any
 * active service areas — inside at least one of them. A zone with no service areas is serviceable as a
 * whole (documented rule). Zones are checked in the given order; callers pass them sorted by specificity.
 * @param {{ lat: number, lng: number }} point
 * @param {{ cities: CityRef[], zones: ZoneRef[], serviceAreas: ServiceAreaRef[] }} data
 * @returns {{ serviceable: boolean, reason: 'OK' | 'NO_CITY' | 'CITY_NOT_LIVE' | 'OUTSIDE_SERVICE_AREA', city: CityRef | null, zone: ZoneRef | null, serviceAreaId: string | null }}
 */
export function resolveServiceability(point, { cities, zones, serviceAreas }) {
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const containing = zones.filter((z) => z.isActive && pointInGeometry(point, z.geometry));
  if (!containing.length) return { serviceable: false, reason: 'NO_CITY', city: null, zone: null, serviceAreaId: null };

  let notLive = null;
  let outsideArea = null;
  for (const zone of containing) {
    const city = cityById.get(zone.cityId);
    if (!city) continue;
    if (!city.isActive) {
      notLive ??= { city, zone };
      continue;
    }
    const areas = serviceAreas.filter((a) => a.zoneId === zone.id && a.isActive);
    if (!areas.length) return { serviceable: true, reason: 'OK', city, zone, serviceAreaId: null };
    const hit = areas.find((a) => inArea(point, a));
    if (hit) return { serviceable: true, reason: 'OK', city, zone, serviceAreaId: hit.id };
    outsideArea ??= { city, zone };
  }
  if (outsideArea) return { serviceable: false, reason: 'OUTSIDE_SERVICE_AREA', ...outsideArea, serviceAreaId: null };
  if (notLive) return { serviceable: false, reason: 'CITY_NOT_LIVE', ...notLive, serviceAreaId: null };
  return { serviceable: false, reason: 'NO_CITY', city: null, zone: null, serviceAreaId: null };
}

/** @param {{ lat: number, lng: number }} point @param {ServiceAreaRef} area */
function inArea(point, area) {
  if (area.kind === 'POLYGON') return pointInGeometry(point, area.geometry);
  return haversineM(point, { lat: Number(area.centerLat), lng: Number(area.centerLng) }) <= Number(area.radiusM);
}
