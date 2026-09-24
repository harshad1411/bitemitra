// Demo restaurants and menus (DATABASE.md §8, DECISIONS D-44). Idempotent: a restaurant is created once;
// its branch, documents, bank account, team and menu are only added when missing.
import { pointInGeometry } from '@jamzo/delivery-engine';
import { ADDON_GROUPS, DEMO_CATEGORIES, DEMO_RESTAURANTS } from './catalog-data.js';

const UNJHA_PIN = '384170';

/**
 * @param {import('@jamzo/database').Db} prisma
 * @param {{ cityId: string, log: (m: string) => void, fieldCipher?: { encrypt: (v: string) => string } }} opts
 */
export async function seedCatalog(prisma, { cityId, log, fieldCipher }) {
  for (const [i, [slug, name]] of DEMO_CATEGORIES.entries()) {
    await prisma.category.upsert({ where: { slug }, create: { slug, name, sortOrder: i }, update: {} });
  }
  const categoryIds = new Map((await prisma.category.findMany()).map((c) => [c.slug, c.id]));
  const zones = await prisma.zone.findMany({ where: { cityId } });
  const zoneFor = (point) =>
    zones.find((z) => pointInGeometry(point, /** @type {any} */ (z.geometry)))?.id ?? null;

  let products = 0;
  for (const [index, def] of DEMO_RESTAURANTS.entries()) {
    const r = await prisma.restaurant.upsert({
      where: { slug: def.slug },
      create: {
        slug: def.slug,
        name: def.name,
        cityId,
        cuisines: def.cuisines,
        isPureVeg: def.isPureVeg,
        phone: def.phone,
        onboardingStatus: def.status,
      },
      update: {},
    });
    const menuMissing = !(await prisma.product.count({ where: { restaurantId: r.id } }));
    // A restaurant created by the Phase 1 demo seed gets its catalog profile when its menu is first added.
    if (menuMissing) {
      await prisma.restaurant.update({
        where: { id: r.id },
        data: { cuisines: def.cuisines, isPureVeg: def.isPureVeg, ...(r.phone ? {} : { phone: def.phone }) },
      });
    }
    await prisma.restaurantSettings.upsert({
      where: { restaurantId: r.id },
      create: { restaurantId: r.id },
      update: {},
    });

    // Team: every demo restaurant gets an owner who can sign in to the partner app with the restaurant phone.
    if (def.phone && !(await prisma.restaurantUser.count({ where: { restaurantId: r.id } }))) {
      const owner = await prisma.user.upsert({
        where: { phone: def.phone },
        create: {
          phone: def.phone,
          name: `${def.name} owner`,
          identities: { create: { provider: 'PHONE_OTP', subject: def.phone } },
        },
        update: {},
      });
      await prisma.restaurantUser.create({ data: { restaurantId: r.id, userId: owner.id, role: 'OWNER' } });
    }

    if (!(await prisma.restaurantBranch.count({ where: { restaurantId: r.id } }))) {
      const b = def.branch;
      const zoneId = zoneFor(b);
      await prisma.restaurantBranch.create({
        data: {
          restaurantId: r.id,
          name: `${def.name}, ${b.area}`,
          addressLine: `${b.area}, Unjha, Gujarat`,
          area: b.area,
          pincode: UNJHA_PIN,
          lat: b.lat,
          lng: b.lng,
          zoneId,
          isPrimary: true,
          businessHours: {
            create: def.hours.map(([dayOfWeek, opensAt, closesAt]) => ({ dayOfWeek, opensAt, closesAt })),
          },
          ...(b.radiusM ? { deliveryAreas: { create: { kind: 'RADIUS', radiusM: b.radiusM } } } : {}),
        },
      });
      if (zoneId)
        await prisma.restaurantZone.createMany({
          data: [{ restaurantId: r.id, zoneId }],
          skipDuplicates: true,
        });
    }

    const live = def.status === 'ACTIVE' || def.status === 'APPROVED';
    if (
      def.status !== 'DRAFT' &&
      !(await prisma.restaurantDocument.count({ where: { restaurantId: r.id } }))
    ) {
      const n = String(index + 1).padStart(4, '0');
      const status = live ? 'VERIFIED' : 'PENDING';
      await prisma.restaurantDocument.createMany({
        data: [
          {
            restaurantId: r.id,
            kind: 'FSSAI',
            number: `1002602200${n}`,
            status,
            expiresOn: new Date('2031-03-31T00:00:00Z'),
          },
          { restaurantId: r.id, kind: 'PAN', number: `AAAFJ${n}Z`, status },
        ],
      });
    }

    // Bank accounts need the encryption key (seed CLI reads FIELD_ENCRYPTION_KEY); fake numbers, fake bank code.
    if (
      fieldCipher &&
      def.status !== 'DRAFT' &&
      !(await prisma.restaurantBankAccount.count({ where: { restaurantId: r.id } }))
    ) {
      const number = `5010${String(index + 1).padStart(10, '0')}`;
      await prisma.restaurantBankAccount.create({
        data: {
          restaurantId: r.id,
          accountHolderName: def.name,
          accountNumberEncrypted: fieldCipher.encrypt(number),
          accountNumberLast4: number.slice(-4),
          ifsc: 'JMZO0000001',
          bankName: 'Demo Bank (fictional)',
          isPrimary: live,
          verifiedAt: live ? new Date() : null,
        },
      });
    }

    if (menuMissing) {
      for (const [sortOrder, [sectionName, items]] of /** @type {[string, any[]][]} */ (def.menu).entries()) {
        const section = await prisma.menuCategory.create({
          data: { restaurantId: r.id, name: sectionName, sortOrder },
        });
        for (const [itemOrder, item] of items.entries()) {
          await prisma.product.create({ data: productData(r.id, section.id, categoryIds, item, itemOrder) });
          products += 1;
        }
      }
    }
  }
  log(
    `demo catalog: ${DEMO_RESTAURANTS.length} restaurants, ${DEMO_CATEGORIES.length} food categories, ${products} products added`,
  );
}

function productData(restaurantId, menuCategoryId, categoryIds, item, sortOrder) {
  const variants = item.v ?? [];
  const price = item.p ?? variants[0][1];
  return {
    restaurantId,
    menuCategoryId,
    categoryId: categoryIds.get(item.c) ?? null,
    name: item.n,
    description: item.d ?? null,
    foodType: item.t ?? 'VEG',
    basePricePaise: price,
    isBestseller: Boolean(item.best),
    isRecommended: Boolean(item.rec),
    isFeatured: Boolean(item.feat),
    isAvailable: !item.off,
    sortOrder,
    searchText: [item.n, item.d].filter(Boolean).join(' ').toLowerCase(),
    variants: {
      create: variants.map(([name, basePricePaise], i) => ({
        name,
        basePricePaise,
        isDefault: i === 0,
        sortOrder: i,
      })),
    },
    addonGroups: {
      create: (item.a ?? []).map((key, gi) => {
        const [name, minSelect, maxSelect, options] = ADDON_GROUPS[key];
        return {
          name,
          minSelect,
          maxSelect,
          sortOrder: gi,
          addons: {
            create: options.map(([optName, basePricePaise, foodType = 'VEG'], ai) => ({
              name: optName,
              basePricePaise,
              foodType,
              sortOrder: ai,
            })),
          },
        };
      }),
    },
    schedules: {
      create: (item.s ?? []).map(([dayOfWeek, startsAt, endsAt]) => ({ dayOfWeek, startsAt, endsAt })),
    },
  };
}
