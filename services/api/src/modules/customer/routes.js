// Customer app endpoints (Phase 3 — spec §5–§8, D-46 … D-48, D-56). Guest browsing follows the setting
// `customer.guestBrowsing`; addresses, favourites and consents need a signed-in customer.
import { z } from 'zod';
import {
  addressBody,
  addressUpdateBody,
  cartQuoteBody,
  consentBody,
  customerRestaurantsQuery,
  customerSearchQuery,
  locationQuery,
  slug as slugSchema,
  uuid,
} from '@jamzo/validation';
import { branchOpenState } from '@jamzo/catalog-engine';
import { AppError, notFound, unauthenticated } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { withIdempotency } from '../../core/idempotency.js';
import { resolvePoint } from '../geography/service.js';
import { mediaUrls } from '../media/urls.js';
import { currentWindowsWhere } from '../catalog/service.js';
import { createMenuPricer, loadRuleSet, ruleTargets } from '../pricing/service.js';
import { customerAvailability, discover, locationFrom, sortCards } from './discovery.js';
import { quoteCart } from './cart.js';

const CUSTOMER = { apps: ['CUSTOMER'] };
const BROWSE = { apps: ['CUSTOMER'], auth: 'optional' };
const idParam = z.object({ id: uuid });

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function customerRoutes(app) {
  const prisma = app.prisma;
  const { config } = app.services;
  const base = app.services.mediaBase;

  async function allowBrowse(request) {
    if (request.auth) return;
    const guest = await config.resolve('customer.guestBrowsing');
    if (!guest.value) throw unauthenticated('Sign in to browse restaurants.');
  }

  /** The signed-in user's customer profile (created at first customer sign-in; created here if missing). */
  async function customerOf(request) {
    if (!request.auth) throw unauthenticated();
    return prisma.customer.upsert({
      where: { userId: request.auth.userId },
      create: { userId: request.auth.userId },
      update: {},
    });
  }

  // ── Listing, search and home ──
  app.get(
    '/v1/customer/restaurants',
    { config: BROWSE },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      await allowBrowse(request);
      const q = parse(customerRestaurantsQuery, request.query);
      const loc = await locationFrom(prisma, request, q);
      const { place, candidates } = await discover(app, { point: loc.point, now: app.clock.now() });
      if (!place.serviceable)
        return {
          serviceable: false,
          reason: place.reason,
          city: place.city ? { name: place.city.name } : null,
          items: [],
          total: 0,
        };
      const term = q.q?.toLowerCase();
      const cards = candidates
        .map((c) => c.card)
        .filter(
          (c) =>
            !term ||
            c.name.toLowerCase().includes(term) ||
            c.cuisines.some((x) => x.toLowerCase().includes(term)),
        )
        .filter((c) => !q.cuisine || c.cuisines.some((x) => x.toLowerCase() === q.cuisine.toLowerCase()))
        .filter((c) => q.veg !== 'true' || c.isPureVeg)
        .filter((c) => q.openNow !== 'true' || c.open.isOpen)
        .filter(
          (c) =>
            q.freeDelivery !== 'true' ||
            c.delivery.feePaise === 0 ||
            c.offers.some((o) => o.discountType === 'FREE_DELIVERY'),
        );
      const sorted = sortCards(cards, q.sort);
      return {
        serviceable: true,
        city: { id: place.city.id, name: place.city.name },
        zone: { id: place.zone.id, name: place.zone.name },
        items: sorted
          .slice(q.offset, q.offset + q.limit)
          .map(({ sortWeight: _s, createdAt: _c, ...card }) => card),
        total: sorted.length,
        nextOffset: q.offset + q.limit < sorted.length ? q.offset + q.limit : null,
      };
    },
  );

  app.get(
    '/v1/customer/search',
    { config: BROWSE },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      await allowBrowse(request);
      const q = parse(customerSearchQuery, request.query);
      const loc = await locationFrom(prisma, request, q);
      const now = app.clock.now();
      const { place, candidates } = await discover(app, { point: loc.point, now });
      if (!place.serviceable)
        return { serviceable: false, reason: place.reason, restaurants: [], dishes: [] };
      const term = q.q.toLowerCase();
      const byId = new Map(candidates.map((c) => /** @type {[string, any]} */ ([c.restaurant.id, c])));
      const restaurants = sortCards(
        candidates
          .map((c) => c.card)
          .filter(
            (c) =>
              c.name.toLowerCase().includes(term) || c.cuisines.some((x) => x.toLowerCase().includes(term)),
          ),
        'RELEVANCE',
      );
      const products = await prisma.product.findMany({
        where: {
          restaurantId: { in: [...byId.keys()] },
          status: 'ACTIVE',
          OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { searchText: { contains: term } }],
        },
        include: {
          variants: true,
          images: { orderBy: { sortOrder: 'asc' }, take: 1, include: { media: true } },
          availability: { where: currentWindowsWhere(now) },
          schedules: true,
        },
        take: 60,
      });
      const pricers = await menuPricers(
        products.map((p) => p.restaurantId),
        byId,
        now,
        products,
      );
      const dishes = products
        .map((p) => {
          const c = byId.get(p.restaurantId);
          const price = pricers.get(p.restaurantId);
          const def = p.variants.find((v) => v.isDefault);
          return {
            id: p.id,
            name: p.name,
            foodType: p.foodType,
            pricePaise: price.item(def?.basePricePaise ?? p.basePricePaise, {
              productId: p.id,
              categoryId: p.categoryId,
              variantId: def?.id,
            }),
            hasVariants: p.variants.length > 0,
            image: p.images[0] ? mediaUrls(p.images[0].media, base) : null,
            availability: customerAvailability(p, now, place.city.timezone),
            restaurant: { id: c.card.id, name: c.card.name, isOpen: c.card.open.isOpen, eta: c.card.eta },
          };
        })
        .sort(
          (a, b) =>
            Number(b.availability.available) - Number(a.availability.available) ||
            Number(b.restaurant.isOpen) - Number(a.restaurant.isOpen),
        )
        .slice(0, 30);
      return {
        serviceable: true,
        query: q.q,
        restaurants: restaurants.slice(0, 20).map(({ sortWeight: _s, createdAt: _c, ...c }) => c),
        dishes,
      };
    },
  );

  /** Markup-applied pricers per restaurant, built from one rule query (no N+1). */
  async function menuPricers(restaurantIds, byId, now, products) {
    const ids = [...new Set(restaurantIds)];
    if (!ids.length) return new Map();
    const any = byId.get(ids[0]);
    const city = any.restaurant.cityId;
    const cityRow = await prisma.city.findUnique({ where: { id: city }, include: { state: true } });
    const targets = ruleTargets({
      countryId: cityRow.state.countryId,
      stateId: cityRow.stateId,
      cityId: city,
      zoneIds: ids.map((id) => byId.get(id).branch.zoneId),
      categoryIds: products.map((p) => p.categoryId).filter(Boolean),
      productIds: products.map((p) => p.id),
      variantIds: products.flatMap((p) => p.variants.map((v) => v.id)),
    })
      .concat(ids.map((id) => ({ scope: 'RESTAURANT', scopeRefId: id })))
      .concat(ids.map((id) => ({ scope: 'BRANCH', scopeRefId: byId.get(id).branch.id })));
    const rules = await loadRuleSet(prisma, targets, now, ['MARKUP']);
    return new Map(
      ids.map((id) => {
        const c = byId.get(id);
        return [
          id,
          createMenuPricer(
            rules.markup,
            {
              countryId: cityRow.state.countryId,
              stateId: cityRow.stateId,
              cityId: city,
              zoneId: c.branch.zoneId ?? undefined,
              restaurantId: id,
              branchId: c.branch.id,
            },
            now,
          ),
        ];
      }),
    );
  }

  app.get(
    '/v1/customer/home',
    { config: BROWSE },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      await allowBrowse(request);
      const q = parse(locationQuery, request.query);
      const loc = await locationFrom(prisma, request, q);
      const now = app.clock.now();
      const { place, candidates } = await discover(app, { point: loc.point, now });
      if (!place.serviceable)
        return {
          serviceable: false,
          reason: place.reason,
          city: place.city ? { id: place.city.id, name: place.city.name } : null,
          sections: [],
        };
      const cityId = place.city.id;
      const zoneId = place.zone.id;
      // Targeting is checked in code: lists created without targets are stored as NULL, which Prisma's
      // `isEmpty` does not match ("no targeting" must mean "everywhere").
      const targeted = (row) =>
        (!row.cityIds?.length || row.cityIds.includes(cityId)) &&
        (!row.zoneIds?.length || row.zoneIds.includes(zoneId));
      const live = {
        isEnabled: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      };
      const sections = (
        await prisma.homeSection.findMany({
          where: live,
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          include: { banners: { where: live, orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
        })
      )
        .filter(targeted)
        .map((s) => ({ ...s, banners: s.banners.filter(targeted) }));
      const isNewCustomer = true; // no orders exist before Phase 5
      const mediaIds = sections
        .flatMap((s) => [s.mediaId, ...s.banners.map((b) => b.mediaId)])
        .filter(Boolean);
      const media = new Map(
        (
          await prisma.media.findMany({ where: { id: { in: mediaIds }, deletedAt: null, kind: 'IMAGE' } })
        ).map((m) => [m.id, m]),
      );
      const img = (id) => (id && media.has(id) ? mediaUrls(media.get(id), base) : null);
      const cards = sortCards(
        candidates.map((c) => c.card),
        'RELEVANCE',
      ).map(({ sortWeight: _s, createdAt: _c, ...c }) => c);
      const byIdCard = new Map(candidates.map((c) => /** @type {[string, any]} */ ([c.card.id, c.card])));
      const reachableIds = candidates.map((c) => c.restaurant.id);
      const byId = new Map(candidates.map((c) => /** @type {[string, any]} */ ([c.restaurant.id, c])));
      const out = [];
      for (const s of sections) {
        const cfg = /** @type {any} */ (s.config ?? {});
        const limit = cfg.limit ?? 10;
        if (/** @type {any} */ (s.audience)?.newCustomers && !isNewCustomer) continue;
        const common = {
          id: s.id,
          type: s.type,
          title: s.title,
          subtitle: s.subtitle,
          background: s.background,
          ctaLabel: s.ctaLabel,
          deepLink: s.deepLink,
        };
        const restaurantsSection = (list) =>
          list.length && out.push({ ...common, restaurants: list.slice(0, limit) });
        switch (s.type) {
          case 'BANNER_CAROUSEL': {
            const banners = s.banners
              .map((b) => ({ id: b.id, title: b.title, deepLink: b.deepLink, image: img(b.mediaId) }))
              .filter((b) => b.image);
            if (banners.length) out.push({ ...common, banners });
            break;
          }
          case 'CATEGORIES': {
            const cats = await prisma.category.findMany({
              where: {
                isActive: true,
                products: { some: { restaurantId: { in: reachableIds }, status: 'ACTIVE' } },
              },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              take: limit,
            });
            if (cats.length)
              out.push({
                ...common,
                categories: cats.map((c) => ({
                  id: c.id,
                  slug: c.slug,
                  name: c.name,
                  icon: img(c.iconMediaId),
                })),
              });
            break;
          }
          case 'TOP_RESTAURANTS':
          case 'POPULAR_NEAR_YOU':
          case 'RECOMMENDED':
            restaurantsSection(cards);
            break;
          case 'NEW_RESTAURANTS':
            restaurantsSection(
              [...candidates]
                .sort((a, b) => b.card.createdAt.getTime() - a.card.createdAt.getTime())
                .map((c) => byIdCard.get(c.card.id))
                .map(({ sortWeight: _s, createdAt: _c, ...c }) => c),
            );
            break;
          case 'TOP_RATED':
            restaurantsSection(
              sortCards(
                cards.map((c) => ({ ...c, sortWeight: 0 })),
                'RATING',
              ).filter((c) => c.rating.count > 0),
            );
            break;
          case 'OFFERS':
            restaurantsSection(cards.filter((c) => c.offers.length));
            break;
          case 'FREE_DELIVERY':
            restaurantsSection(
              cards.filter(
                (c) =>
                  c.delivery.feePaise === 0 ||
                  c.delivery.freeAboveSubtotalPaise != null ||
                  c.offers.some((o) => o.discountType === 'FREE_DELIVERY'),
              ),
            );
            break;
          case 'CUISINE_COLLECTION':
            restaurantsSection(
              cards.filter((c) =>
                c.cuisines.some((x) => x.toLowerCase() === String(cfg.cuisine).toLowerCase()),
              ),
            );
            break;
          case 'RESTAURANT_COLLECTION':
            restaurantsSection(
              (cfg.restaurantIds ?? []).map((id) => cards.find((c) => c.id === id)).filter(Boolean),
            );
            break;
          case 'UNDER_PRICE':
          case 'PRODUCT_COLLECTION': {
            const products = await prisma.product.findMany({
              where: {
                restaurantId: { in: reachableIds },
                status: 'ACTIVE',
                isAvailable: true,
                ...(s.type === 'PRODUCT_COLLECTION' ? { id: { in: cfg.productIds ?? [] } } : {}),
              },
              include: {
                variants: true,
                images: { orderBy: { sortOrder: 'asc' }, take: 1, include: { media: true } },
              },
              orderBy: [{ isBestseller: 'desc' }, { sortOrder: 'asc' }],
              take: 200,
            });
            const pricers = await menuPricers(
              products.map((p) => p.restaurantId),
              byId,
              now,
              products,
            );
            const dishes = products
              .map((p) => {
                const def = p.variants.find((v) => v.isDefault);
                return {
                  id: p.id,
                  name: p.name,
                  foodType: p.foodType,
                  pricePaise: pricers.get(p.restaurantId).item(def?.basePricePaise ?? p.basePricePaise, {
                    productId: p.id,
                    categoryId: p.categoryId,
                    variantId: def?.id,
                  }),
                  image: p.images[0] ? mediaUrls(p.images[0].media, base) : null,
                  restaurant: { id: p.restaurantId, name: byId.get(p.restaurantId).card.name },
                };
              })
              .filter((d) => s.type !== 'UNDER_PRICE' || d.pricePaise <= cfg.maxPricePaise)
              .slice(0, limit);
            if (dishes.length) out.push({ ...common, dishes });
            break;
          }
          case 'IMAGE_PROMO':
            if (img(s.mediaId)) out.push({ ...common, image: img(s.mediaId) });
            break;
          case 'TEXT':
            out.push(common);
            break;
          default:
            break;
        }
      }
      // With no CMS sections configured the app still gets a useful home: every restaurant that delivers here.
      if (!sections.length && cards.length)
        out.push({
          id: 'default-all',
          type: 'TOP_RESTAURANTS',
          title: 'Restaurants near you',
          restaurants: cards,
        });
      return {
        serviceable: true,
        city: { id: cityId, name: place.city.name },
        zone: { id: zoneId, name: place.zone.name },
        restaurantCount: cards.length,
        sections: out,
      };
    },
  );

  // ── Restaurant detail and menu with customer prices ──
  app.get(
    '/v1/customer/restaurants/:id',
    { config: BROWSE },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      await allowBrowse(request);
      const { id } = parse(idParam, request.params);
      const q = parse(locationQuery, request.query);
      const now = app.clock.now();
      const r = await prisma.restaurant.findFirst({
        where: { id, onboardingStatus: 'ACTIVE' },
        include: {
          city: { include: { state: true } },
          branches: { include: { businessHours: true }, orderBy: [{ isPrimary: 'desc' }] },
        },
      });
      if (!r) throw notFound('Restaurant');
      let deliverability = { checked: false };
      let card = null;
      let branch = r.branches[0];
      if (q.addressId || (q.lat !== undefined && q.lng !== undefined)) {
        const loc = await locationFrom(prisma, request, q);
        const found = await discover(app, { point: loc.point, restaurantIds: [id], now });
        const c = found.candidates[0];
        if (c) {
          card = c.card;
          branch = c.branch;
          deliverability = { checked: true, deliverable: true };
        } else
          deliverability = {
            checked: true,
            deliverable: false,
            reason: found.place.serviceable ? 'OUT_OF_DELIVERY_AREA' : found.place.reason,
          };
      }
      const tz = r.city.timezone;
      const [sections, products] = await Promise.all([
        prisma.menuCategory.findMany({
          where: { restaurantId: id, isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
        prisma.product.findMany({
          where: { restaurantId: id, status: 'ACTIVE' },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
            addonGroups: {
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              include: { addons: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
            },
            images: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
            availability: { where: currentWindowsWhere(now) },
            schedules: true,
          },
        }),
      ]);
      const pricerCtx = {
        countryId: r.city.state.countryId,
        stateId: r.city.stateId,
        cityId: r.cityId,
        zoneId: branch?.zoneId ?? undefined,
        restaurantId: id,
        branchId: branch?.id,
      };
      const rules = await loadRuleSet(
        prisma,
        ruleTargets({
          ...pricerCtx,
          zoneIds: [branch?.zoneId],
          categoryIds: products.map((p) => p.categoryId).filter(Boolean),
          productIds: products.map((p) => p.id),
          variantIds: products.flatMap((p) => p.variants.map((v) => v.id)),
        }),
        now,
        ['MARKUP'],
      );
      const price = createMenuPricer(rules.markup, pricerCtx, now);
      const productDto = (p) => {
        const keys = { productId: p.id, categoryId: p.categoryId };
        const variants = p.variants.map((v) => ({
          id: v.id,
          name: v.name,
          isDefault: v.isDefault,
          isAvailable: v.isAvailable,
          pricePaise: price.item(v.basePricePaise, { ...keys, variantId: v.id }),
        }));
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          foodType: p.foodType,
          pricePaise: variants.length
            ? variants.find((v) => v.isDefault).pricePaise
            : price.item(p.basePricePaise, { ...keys, variantId: null }),
          isBestseller: p.isBestseller,
          isRecommended: p.isRecommended,
          images: p.images.map((i) => mediaUrls(i.media, base)),
          variants,
          addonGroups: p.addonGroups.map((g) => ({
            id: g.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            addons: g.addons.map((a) => ({
              id: a.id,
              name: a.name,
              foodType: a.foodType,
              isAvailable: a.isAvailable,
              pricePaise: price.addon(a.basePricePaise, keys),
            })),
          })),
          schedules: p.schedules.map(({ dayOfWeek, startsAt, endsAt }) => ({ dayOfWeek, startsAt, endsAt })),
          availability: customerAvailability(p, now, tz),
        };
      };
      const bySection = new Map(sections.map((s) => [s.id, []]));
      const others = [];
      for (const p of products)
        (bySection.get(p.menuCategoryId) ?? (p.menuCategoryId ? null : others))?.push(productDto(p));
      /** @type {any} */
      const open = branch
        ? branchOpenState(
            {
              restaurantStatus: r.onboardingStatus,
              isOpen: branch.isOpen,
              pausedUntil: branch.pausedUntil,
              hours: branch.businessHours,
            },
            now,
            tz,
          )
        : { open: false, reason: 'NO_HOURS' };
      const favorite = request.auth
        ? Boolean(
            await prisma.favoriteRestaurant.findFirst({
              where: { restaurantId: id, customer: { userId: request.auth.userId } },
            }),
          )
        : false;
      return {
        restaurant: {
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          cuisines: r.cuisines,
          isPureVeg: r.isPureVeg,
          rating: { average: Number(r.ratingAvg), count: r.ratingCount },
          address: branch ? [branch.addressLine, branch.area].filter(Boolean).join(', ') : null,
          fssaiNumber: r.fssaiNumber,
          hours: (branch?.businessHours ?? [])
            .map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt }))
            .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt)),
          open: {
            isOpen: open.open,
            reason: open.reason,
            closesAt: open.closesAt ?? null,
            nextOpenLocal: open.nextOpenLocal ?? null,
            pausedUntil: open.pausedUntil ?? null,
          },
          isFavorite: favorite,
        },
        delivery: card
          ? {
              ...deliverability,
              distanceM: card.distanceM,
              distanceSource: card.distanceSource,
              eta: card.eta,
              feePaise: card.delivery.feePaise,
              freeAboveSubtotalPaise: card.delivery.freeAboveSubtotalPaise,
              offers: card.offers,
            }
          : deliverability,
        sections: [
          ...sections
            .map((s) => ({ id: s.id, name: s.name, products: bySection.get(s.id) }))
            .filter((s) => s.products.length),
          ...(others.length ? [{ id: 'others', name: 'More items', products: others }] : []),
        ],
        pricesInclude: 'Menu prices are Jamzo prices; taxes and fees are shown in your cart.',
      };
    },
  );

  // ── Cart quote (Phase 4 pricing, D-46) ──
  app.post(
    '/v1/customer/cart/quote',
    { config: { ...BROWSE, rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      await allowBrowse(request);
      const body = parse(cartQuoteBody, request.body);
      return quoteCart(app, request, body, { audience: 'CUSTOMER' });
    },
  );

  // ── Addresses ──
  const addressDto = (a, defaultId) => ({
    id: a.id,
    label: a.label,
    line1: a.line1,
    line2: a.line2,
    landmark: a.landmark,
    area: a.area,
    cityName: a.cityName,
    pincode: a.pincode,
    lat: Number(a.lat),
    lng: Number(a.lng),
    contactName: a.contactName,
    contactPhone: a.contactPhone,
    isDefault: a.id === defaultId,
    serviceable: Boolean(a.zoneId),
  });

  app.get(
    '/v1/customer/addresses',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const customer = await customerOf(request);
      const rows = await prisma.customerAddress.findMany({
        where: { customerId: customer.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return { items: rows.map((a) => addressDto(a, customer.defaultAddressId)) };
    },
  );

  app.post(
    '/v1/customer/addresses',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const body = parse(addressBody, request.body);
      const customer = await customerOf(request);
      const count = await prisma.customerAddress.count({
        where: { customerId: customer.id, deletedAt: null },
      });
      if (count >= 20) throw new AppError('CONFLICT', 'You can save up to 20 addresses. Delete one first.');
      const place = await resolvePoint(prisma, body);
      return withIdempotency(request, reply, { successStatus: 201 }, () =>
        prisma.$transaction(async (tx) => {
          const { makeDefault, ...data } = body;
          const a = await tx.customerAddress.create({
            data: {
              ...data,
              customerId: customer.id,
              cityName: place.city?.name ?? 'Unknown',
              zoneId: place.serviceable ? place.zone.id : null,
            },
          });
          const defaultId = makeDefault || !customer.defaultAddressId ? a.id : customer.defaultAddressId;
          if (defaultId !== customer.defaultAddressId)
            await tx.customer.update({ where: { id: customer.id }, data: { defaultAddressId: defaultId } });
          return {
            ...addressDto(a, defaultId),
            serviceability: { serviceable: place.serviceable, reason: place.reason },
          };
        }),
      );
    },
  );

  async function ownAddress(customer, id) {
    const a = await prisma.customerAddress.findFirst({
      where: { id, customerId: customer.id, deletedAt: null },
    });
    if (!a) throw notFound('Address');
    return a;
  }

  app.patch(
    '/v1/customer/addresses/:id',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const body = parse(addressUpdateBody, request.body);
      const customer = await customerOf(request);
      const before = await ownAddress(customer, id);
      const { makeDefault, ...data } = body;
      if (data.lat !== undefined || data.lng !== undefined) {
        const place = await resolvePoint(prisma, {
          lat: data.lat ?? Number(before.lat),
          lng: data.lng ?? Number(before.lng),
        });
        Object.assign(data, {
          cityName: place.city?.name ?? 'Unknown',
          zoneId: place.serviceable ? place.zone.id : null,
        });
      }
      const a = await prisma.customerAddress.update({ where: { id }, data });
      let defaultId = customer.defaultAddressId;
      if (makeDefault) {
        defaultId = id;
        await prisma.customer.update({ where: { id: customer.id }, data: { defaultAddressId: id } });
      }
      return addressDto(a, defaultId);
    },
  );

  app.delete(
    '/v1/customer/addresses/:id',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const { id } = parse(idParam, request.params);
      const customer = await customerOf(request);
      await ownAddress(customer, id);
      await prisma.$transaction(async (tx) => {
        await tx.customerAddress.update({ where: { id }, data: { deletedAt: app.clock.now() } }); // soft delete (orders keep their copy)
        if (customer.defaultAddressId === id)
          await tx.customer.update({ where: { id: customer.id }, data: { defaultAddressId: null } });
      });
      reply.code(204);
      return null;
    },
  );

  // ── Favourites ──
  app.get(
    '/v1/customer/favorites',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const customer = await customerOf(request);
      const rows = await prisma.favoriteRestaurant.findMany({
        where: { customerId: customer.id, restaurant: { onboardingStatus: 'ACTIVE' } },
        include: { restaurant: true },
        orderBy: { createdAt: 'desc' },
      });
      return {
        items: rows.map((f) => ({
          id: f.restaurant.id,
          name: f.restaurant.name,
          cuisines: f.restaurant.cuisines,
          isPureVeg: f.restaurant.isPureVeg,
        })),
      };
    },
  );

  app.put(
    '/v1/customer/favorites/:id',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const customer = await customerOf(request);
      if (!(await prisma.restaurant.findFirst({ where: { id, onboardingStatus: 'ACTIVE' } })))
        throw notFound('Restaurant');
      await prisma.favoriteRestaurant.upsert({
        where: { customerId_restaurantId: { customerId: customer.id, restaurantId: id } },
        create: { customerId: customer.id, restaurantId: id },
        update: {},
      });
      return { restaurantId: id, isFavorite: true };
    },
  );

  app.delete(
    '/v1/customer/favorites/:id',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(idParam, request.params);
      const customer = await customerOf(request);
      await prisma.favoriteRestaurant.deleteMany({ where: { customerId: customer.id, restaurantId: id } });
      return { restaurantId: id, isFavorite: false };
    },
  );

  // ── Consents (DPDP; legal texts pending Q-12) ──
  app.post(
    '/v1/customer/consents',
    { config: CUSTOMER },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const body = parse(consentBody, request.body);
      const record = await prisma.consentRecord.create({
        data: { ...body, userId: request.auth.userId, ipAddress: request.ip },
      });
      reply.code(201);
      return {
        id: record.id,
        kind: record.kind,
        version: record.version,
        granted: record.granted,
        createdAt: record.createdAt,
      };
    },
  );

  // ── Public CMS pages (terms, privacy, FAQ) — any first-party app ──
  app.get(
    '/v1/cms/pages/:slug',
    { config: { auth: 'none' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { slug } = parse(z.object({ slug: slugSchema }), request.params);
      const page = await prisma.cmsPage.findFirst({ where: { slug, isPublished: true } });
      if (!page) throw notFound('Page');
      return { slug: page.slug, title: page.title, body: page.body, updatedAt: page.updatedAt };
    },
  );
}
