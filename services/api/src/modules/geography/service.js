// Serviceability of a point (DELIVERY.md §1, D-19): indexed bbox pre-filter in PostgreSQL, then the exact
// point-in-polygon test in the pure delivery engine. Shared by the public check, addresses, discovery and quotes.
import { resolveServiceability } from '@jamzo/delivery-engine';

const num = (d) => (d == null ? null : Number(d));
const area = (z) => (Number(z.maxLat) - Number(z.minLat)) * (Number(z.maxLng) - Number(z.minLng));

/**
 * @param {import('@jamzo/database').Db} prisma
 * @param {{ lat: number, lng: number }} point
 * @returns {Promise<{ serviceable: boolean, reason: string, city: any | null, zone: any | null }>}
 */
export async function resolvePoint(prisma, point) {
  const zones = await prisma.zone.findMany({
    where: {
      isActive: true,
      minLat: { lte: point.lat },
      maxLat: { gte: point.lat },
      minLng: { lte: point.lng },
      maxLng: { gte: point.lng },
    },
    include: { city: { include: { state: true } }, serviceAreas: { where: { isActive: true } } },
  });
  zones.sort((a, b) => area(a) - area(b)); // more specific (smaller) zones first when zones overlap
  const result = resolveServiceability(point, {
    cities: zones.map((z) => z.city),
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      slug: z.slug,
      cityId: z.cityId,
      isActive: z.isActive,
      geometry: z.geometry,
    })),
    serviceAreas: zones.flatMap((z) =>
      z.serviceAreas.map((a) => ({ ...a, centerLat: num(a.centerLat), centerLng: num(a.centerLng) })),
    ),
  });
  const city = result.city ? (zones.find((z) => z.cityId === result.city.id)?.city ?? result.city) : null;
  return { serviceable: result.serviceable, reason: result.reason, city, zone: result.zone };
}
