// Catalog rules shared by admin and partner routes (RESTAURANTS.md §4–§5, D-37, D-38).
import {
  effectiveBasePrice,
  endOfLocalDay,
  productAvailability,
  validateProductStructure,
  validateWeeklyRows,
} from '@jamzo/catalog-engine';
import { AppError, invalid, notFound } from '../../core/errors.js';
import { mediaUrls } from '../media/urls.js';

/** Only windows that can still matter are loaded. */
export const currentWindowsWhere = (now) => ({ OR: [{ endsAt: null }, { endsAt: { gt: now } }] });

export const productInclude = (now) => ({
  variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  addonGroups: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { addons: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
  },
  images: { orderBy: { sortOrder: 'asc' }, include: { media: true } },
  availability: { where: currentWindowsWhere(now), orderBy: { startsAt: 'desc' } },
  schedules: { orderBy: [{ dayOfWeek: 'asc' }, { startsAt: 'asc' }] },
});

const availabilityOf = (p, now, tz) =>
  productAvailability(
    {
      status: p.status,
      isAvailable: p.isAvailable,
      stockQuantity: p.stockQuantity,
      windows: p.availability ?? [],
      schedules: p.schedules ?? [],
      variants: p.variants ?? [],
    },
    now,
    tz,
  );

const imageDto = (img, base) => ({
  mediaId: img.mediaId,
  altText: img.media?.altText ?? null,
  urls: mediaUrls(img.media, base),
});

/** Full product (editor / detail). */
export function productDto(p, { now, timeZone, mediaBase }) {
  return {
    id: p.id,
    restaurantId: p.restaurantId,
    menuCategoryId: p.menuCategoryId,
    categoryId: p.categoryId,
    name: p.name,
    description: p.description,
    foodType: p.foodType,
    basePricePaise: p.basePricePaise,
    packagingChargePaise: p.packagingChargePaise,
    taxInclusive: p.taxInclusive,
    prepTimeMinutes: p.prepTimeMinutes,
    isBestseller: p.isBestseller,
    isRecommended: p.isRecommended,
    isFeatured: p.isFeatured,
    status: p.status,
    isAvailable: p.isAvailable,
    stockQuantity: p.stockQuantity,
    sortOrder: p.sortOrder,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    variants: p.variants.map(({ id, name, basePricePaise, isDefault, isAvailable }) => ({
      id,
      name,
      basePricePaise,
      isDefault,
      isAvailable,
    })),
    addonGroups: p.addonGroups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      addons: g.addons.map(({ id, name, basePricePaise, foodType, isAvailable }) => ({
        id,
        name,
        basePricePaise,
        foodType,
        isAvailable,
      })),
    })),
    images: p.images.map((img) => imageDto(img, mediaBase)),
    schedules: p.schedules.map(({ dayOfWeek, startsAt, endsAt }) => ({ dayOfWeek, startsAt, endsAt })),
    soldOutWindows: (p.availability ?? [])
      .filter((w) => !w.isAvailable)
      .map(({ id, startsAt, endsAt, reason }) => ({ id, startsAt, endsAt, reason })),
    availability: availabilityOf(p, now, timeZone),
  };
}

/** Compact row for menus and lists. */
export function productSummary(p, { now, timeZone, mediaBase }) {
  const first = p.images?.[0];
  return {
    id: p.id,
    restaurantId: p.restaurantId,
    menuCategoryId: p.menuCategoryId,
    name: p.name,
    foodType: p.foodType,
    basePricePaise: p.basePricePaise,
    status: p.status,
    isAvailable: p.isAvailable,
    stockQuantity: p.stockQuantity,
    isBestseller: p.isBestseller,
    isRecommended: p.isRecommended,
    isFeatured: p.isFeatured,
    sortOrder: p.sortOrder,
    version: p.version,
    variants: (p.variants ?? []).map(({ id, name, basePricePaise, isDefault, isAvailable }) => ({
      id,
      name,
      basePricePaise,
      isDefault,
      isAvailable,
    })),
    addonGroups: (p.addonGroups ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      addons: g.addons.map(({ id, name, basePricePaise, isAvailable }) => ({
        id,
        name,
        basePricePaise,
        isAvailable,
      })),
    })),
    image: first ? imageDto(first, mediaBase) : null,
    availability: availabilityOf(p, now, timeZone),
  };
}

/**
 * Whole menu of a restaurant in a constant number of queries (no N+1, OD-27).
 * @param {import('@jamzo/database').Db} prisma
 * @param {string} restaurantId
 * @param {{ now: Date, timeZone: string, mediaBase: string, includeArchived?: boolean }} opts
 */
export async function loadMenu(prisma, restaurantId, opts) {
  const [sections, products] = await Promise.all([
    prisma.menuCategory.findMany({
      where: { restaurantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.product.findMany({
      where: { restaurantId, ...(opts.includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        variants: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        addonGroups: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          include: { addons: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
        },
        images: { orderBy: { sortOrder: 'asc' }, take: 1, include: { media: true } },
        availability: { where: currentWindowsWhere(opts.now) },
        schedules: true,
      },
    }),
  ]);
  const bySection = new Map(sections.map((s) => [s.id, []]));
  const unsectioned = [];
  for (const p of products) {
    const summary = productSummary(p, opts);
    (bySection.get(p.menuCategoryId) ?? unsectioned).push(summary);
  }
  return {
    sections: sections.map((s) => ({
      id: s.id,
      name: s.name,
      isActive: s.isActive,
      sortOrder: s.sortOrder,
      products: bySection.get(s.id),
    })),
    unsectioned,
    productCount: products.length,
  };
}

/**
 * Validates references and structure of a product write; returns the normalised data.
 * @param {import('@jamzo/database').Db} tx
 * @param {any} input parsed productCreateBody / productUpdateBody
 * @param {{ id: string, isPureVeg: boolean }} restaurant
 * @param {any | null} existing product with variants and addon groups (update) or null (create)
 */
export async function checkProductWrite(tx, input, restaurant, existing) {
  /** @type {Record<string, string[]>} */
  const errors = { ...validateProductStructure(input, { pureVeg: restaurant.isPureVeg }) };
  const add = (k, m) => (errors[k] ??= []).push(m);
  for (const [k, v] of Object.entries(validateWeeklyRows(input.schedules))) errors[`schedules.${k}`] = v;

  if (input.menuCategoryId) {
    const section = await tx.menuCategory.findUnique({ where: { id: input.menuCategoryId } });
    if (!section || section.restaurantId !== restaurant.id)
      add('menuCategoryId', 'Choose a section of this restaurant’s menu');
  }
  if (input.categoryId && !(await tx.category.findFirst({ where: { id: input.categoryId, isActive: true } })))
    add('categoryId', 'Unknown or inactive food category');
  if (input.imageMediaIds.length) {
    const found = await tx.media.count({
      where: { id: { in: input.imageMediaIds }, kind: 'IMAGE', deletedAt: null },
    });
    if (found !== new Set(input.imageMediaIds).size)
      add('imageMediaIds', 'Choose images from the media library');
  }
  // Child ids must belong to this product (never to another one).
  const ownVariants = new Set((existing?.variants ?? []).map((v) => v.id));
  const ownGroups = new Set((existing?.addonGroups ?? []).map((g) => g.id));
  // An add-on keeps its group: moving it would race with the group's cascade delete.
  const addonGroupOf = new Map(
    (existing?.addonGroups ?? []).flatMap((g) => g.addons.map((a) => [a.id, g.id])),
  );
  input.variants.forEach(
    (v, i) => v.id && !ownVariants.has(v.id) && add(`variants.${i}.id`, 'Unknown variant'),
  );
  input.addonGroups.forEach((g, gi) => {
    if (g.id && !ownGroups.has(g.id)) add(`addonGroups.${gi}.id`, 'Unknown add-on group');
    g.addons.forEach(
      (a, ai) =>
        a.id &&
        (!g.id || addonGroupOf.get(a.id) !== g.id) &&
        add(`addonGroups.${gi}.addons.${ai}.id`, 'Unknown add-on for this group'),
    );
  });
  if (Object.keys(errors).length) throw invalid('Some product details are invalid.', errors);

  const { variants, addonGroups, imageMediaIds, schedules, version: _v, restaurantId: _r, ...fields } = input;
  const searchText = [input.name, input.description].filter(Boolean).join(' ').toLowerCase().slice(0, 2000);
  return {
    fields: { ...fields, basePricePaise: effectiveBasePrice(input), searchText },
    variants,
    addonGroups,
    imageMediaIds,
    schedules,
  };
}

/**
 * Writes a product and all its children. Existing children are updated by id, new ones created, missing
 * ones removed (D-37). Update uses optimistic concurrency on `version`.
 * @param {import('@jamzo/database').Db} tx
 * @param {{ restaurantId: string, productId?: string, expectedVersion?: number, data: Awaited<ReturnType<typeof checkProductWrite>> }} w
 */
export async function writeProduct(tx, { restaurantId, productId, expectedVersion, data }) {
  let id = productId;
  if (!id) {
    const created = await tx.product.create({ data: { ...data.fields, restaurantId } });
    id = created.id;
  } else {
    const { count } = await tx.product.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data.fields, version: { increment: 1 } },
    });
    if (count !== 1) {
      const current = await tx.product.findUnique({ where: { id }, select: { version: true } });
      if (!current) throw notFound('Product');
      throw new AppError(
        'CONFLICT',
        'Someone else saved this product after you opened it. Reload to see their changes.',
        {
          details: { currentVersion: current.version },
        },
      );
    }
  }

  // Variants — clear defaults first so the "one default" index never sees two at once.
  const keepVariants = data.variants.filter((v) => v.id).map((v) => v.id);
  await tx.productVariant.deleteMany({ where: { productId: id, id: { notIn: keepVariants } } });
  await tx.productVariant.updateMany({ where: { productId: id }, data: { isDefault: false } });
  for (const [sortOrder, v] of data.variants.entries()) {
    const row = {
      name: v.name,
      basePricePaise: v.basePricePaise,
      isDefault: v.isDefault,
      isAvailable: v.isAvailable,
      sortOrder,
    };
    if (v.id) await tx.productVariant.update({ where: { id: v.id }, data: row });
    else await tx.productVariant.create({ data: { ...row, productId: id } });
  }

  // Add-on groups and add-ons.
  const keepGroups = data.addonGroups.filter((g) => g.id).map((g) => g.id);
  await tx.productAddonGroup.deleteMany({ where: { productId: id, id: { notIn: keepGroups } } });
  const keepAddons = data.addonGroups.flatMap((g) => g.addons.filter((a) => a.id).map((a) => a.id));
  await tx.productAddon.deleteMany({ where: { group: { productId: id }, id: { notIn: keepAddons } } });
  for (const [gi, g] of data.addonGroups.entries()) {
    const groupRow = { name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, sortOrder: gi };
    const group = g.id
      ? await tx.productAddonGroup.update({ where: { id: g.id }, data: groupRow })
      : await tx.productAddonGroup.create({ data: { ...groupRow, productId: id } });
    for (const [ai, a] of g.addons.entries()) {
      const row = {
        name: a.name,
        basePricePaise: a.basePricePaise,
        foodType: a.foodType,
        isAvailable: a.isAvailable,
        sortOrder: ai,
        groupId: group.id,
      };
      if (a.id) await tx.productAddon.update({ where: { id: a.id }, data: row });
      else await tx.productAddon.create({ data: row });
    }
  }

  await tx.productImage.deleteMany({ where: { productId: id } });
  if (data.imageMediaIds.length)
    await tx.productImage.createMany({
      data: data.imageMediaIds.map((mediaId, sortOrder) => ({ productId: id, mediaId, sortOrder })),
    });
  await tx.productSchedule.deleteMany({ where: { productId: id } });
  if (data.schedules.length)
    await tx.productSchedule.createMany({ data: data.schedules.map((s) => ({ ...s, productId: id })) });
  return id;
}

/**
 * Sold out / back in stock for a product, variant or add-on (RESTAURANTS.md §4). Bumps the product version
 * so an editor opened earlier cannot silently undo the change.
 * @param {import('@jamzo/database').Db} tx
 * @param {any} product
 * @param {{ isAvailable: boolean, variantId?: string, addonId?: string, until?: string, reason?: string | null }} body
 * @param {{ now: Date, timeZone: string }} ctx
 * @returns {Promise<{ target: string, before: any, after: any }>}
 */
export async function applyAvailability(tx, product, body, { now, timeZone }) {
  if (body.variantId) {
    const v = await tx.productVariant.findFirst({ where: { id: body.variantId, productId: product.id } });
    if (!v) throw notFound('Variant');
    await tx.productVariant.update({ where: { id: v.id }, data: { isAvailable: body.isAvailable } });
    await tx.product.update({ where: { id: product.id }, data: { version: { increment: 1 } } });
    return {
      target: `variant:${v.name}`,
      before: { isAvailable: v.isAvailable },
      after: { isAvailable: body.isAvailable },
    };
  }
  if (body.addonId) {
    const a = await tx.productAddon.findFirst({
      where: { id: body.addonId, group: { productId: product.id } },
    });
    if (!a) throw notFound('Add-on');
    await tx.productAddon.update({ where: { id: a.id }, data: { isAvailable: body.isAvailable } });
    await tx.product.update({ where: { id: product.id }, data: { version: { increment: 1 } } });
    return {
      target: `addon:${a.name}`,
      before: { isAvailable: a.isAvailable },
      after: { isAvailable: body.isAvailable },
    };
  }
  const before = { isAvailable: product.isAvailable };
  if (body.isAvailable) {
    // Back in stock: switch on and end any sold-out window in force.
    await tx.productAvailability.updateMany({
      where: {
        productId: product.id,
        isAvailable: false,
        startsAt: { lte: now },
        ...currentWindowsWhere(now),
      },
      data: { endsAt: now },
    });
    await tx.product.update({
      where: { id: product.id },
      data: { isAvailable: true, version: { increment: 1 } },
    });
    return { target: 'product', before, after: { isAvailable: true } };
  }
  if (!body.until) {
    await tx.product.update({
      where: { id: product.id },
      data: { isAvailable: false, version: { increment: 1 } },
    });
    return { target: 'product', before, after: { isAvailable: false, until: null } };
  }
  const until = body.until === 'END_OF_DAY' ? endOfLocalDay(now, timeZone) : new Date(body.until);
  const maxUntil = now.getTime() + 30 * 24 * 60 * 60 * 1000;
  if (until <= now || until.getTime() > maxUntil)
    throw invalid('Choose a time in the next 30 days.', {
      until: ['Must be in the future, at most 30 days ahead'],
    });
  await tx.productAvailability.create({
    data: {
      productId: product.id,
      isAvailable: false,
      startsAt: now,
      endsAt: until,
      reason: body.reason ?? null,
    },
  });
  await tx.product.update({ where: { id: product.id }, data: { version: { increment: 1 } } });
  return { target: 'product', before, after: { isAvailable: false, until: until.toISOString() } };
}
