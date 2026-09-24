import { describe, expect, it } from 'vitest';
import { bboxOf, haversineM, pointInGeometry } from './geo.js';
import { resolveServiceability } from './serviceability.js';

const square = (x0, y0, x1, y1, holes = []) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], ...holes],
});

describe('geo', () => {
  it('haversine distance in metres', () => {
    // Unjha → Mehsana ≈ 24 km straight line
    const d = haversineM({ lat: 23.8053, lng: 72.3935 }, { lat: 23.588, lng: 72.3693 });
    expect(d).toBeGreaterThan(24_000);
    expect(d).toBeLessThan(24_500);
    expect(haversineM({ lat: 23.8, lng: 72.39 }, { lat: 23.8, lng: 72.39 })).toBe(0);
  });

  it('point-in-polygon: inside, outside, vertex, edge, holes, multipolygon', () => {
    const poly = square(0, 0, 10, 10, [[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]);
    expect(pointInGeometry({ lng: 1, lat: 1 }, poly)).toBe(true);
    expect(pointInGeometry({ lng: 11, lat: 1 }, poly)).toBe(false);
    expect(pointInGeometry({ lng: 0, lat: 0 }, poly)).toBe(true); // vertex
    expect(pointInGeometry({ lng: 10, lat: 5 }, poly)).toBe(true); // edge
    expect(pointInGeometry({ lng: 5, lat: 5 }, poly)).toBe(false); // in hole
    expect(pointInGeometry({ lng: 4, lat: 5 }, poly)).toBe(true); // on hole edge
    const multi = { type: 'MultiPolygon', coordinates: [square(0, 0, 1, 1).coordinates, square(5, 5, 6, 6).coordinates] };
    expect(pointInGeometry({ lng: 5.5, lat: 5.5 }, multi)).toBe(true);
    expect(pointInGeometry({ lng: 3, lat: 3 }, multi)).toBe(false);
  });

  it('bbox', () => {
    expect(bboxOf(square(72.38, 23.79, 72.41, 23.82))).toEqual({ minLat: 23.79, minLng: 72.38, maxLat: 23.82, maxLng: 72.41 });
  });
});

describe('serviceability', () => {
  const cities = [
    { id: 'unjha', name: 'Unjha', slug: 'unjha', isActive: true },
    { id: 'mehsana', name: 'Mehsana', slug: 'mehsana', isActive: false },
  ];
  const zones = [
    { id: 'z-central', cityId: 'unjha', name: 'Central', slug: 'central', isActive: true, geometry: square(72.38, 23.79, 72.41, 23.82) },
    { id: 'z-east', cityId: 'unjha', name: 'East', slug: 'east', isActive: true, geometry: square(72.41, 23.79, 72.44, 23.82) },
    { id: 'z-closed', cityId: 'unjha', name: 'Closed', slug: 'closed', isActive: false, geometry: square(72.44, 23.79, 72.47, 23.82) },
    { id: 'z-meh', cityId: 'mehsana', name: 'M', slug: 'm', isActive: true, geometry: square(72.35, 23.57, 72.4, 23.62) },
  ];
  const serviceAreas = [
    { id: 'sa-radius', zoneId: 'z-east', kind: 'RADIUS', centerLat: 23.805, centerLng: 72.425, radiusM: 1000, isActive: true },
  ];
  const data = { cities, zones, serviceAreas };

  it('zone without service areas is serviceable as a whole', () => {
    const r = resolveServiceability({ lat: 23.8, lng: 72.39 }, data);
    expect(r).toMatchObject({ serviceable: true, reason: 'OK', zone: { id: 'z-central' }, city: { id: 'unjha' } });
  });

  it('zone with service areas requires being inside one', () => {
    expect(resolveServiceability({ lat: 23.805, lng: 72.426 }, data)).toMatchObject({ serviceable: true, serviceAreaId: 'sa-radius' });
    expect(resolveServiceability({ lat: 23.818, lng: 72.438 }, data)).toMatchObject({ serviceable: false, reason: 'OUTSIDE_SERVICE_AREA' });
  });

  it('inactive zones and non-live cities are not serviceable', () => {
    expect(resolveServiceability({ lat: 23.8, lng: 72.45 }, data)).toMatchObject({ serviceable: false, reason: 'NO_CITY' });
    expect(resolveServiceability({ lat: 23.6, lng: 72.37 }, data)).toMatchObject({ serviceable: false, reason: 'CITY_NOT_LIVE', city: { id: 'mehsana' } });
    expect(resolveServiceability({ lat: 10, lng: 10 }, data)).toMatchObject({ serviceable: false, reason: 'NO_CITY' });
  });
});
