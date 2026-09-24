// Product structure rules (RESTAURANTS.md §5, DECISIONS D-37). Returns field errors keyed by path so the
// API can send them in the standard error body and the admin can show them next to the right input.

/** Add-on food types allowed on a product of each food type. */
export const COMPATIBLE_ADDON_FOOD_TYPES = Object.freeze({
  VEGAN: ['VEGAN'],
  VEG: ['VEG', 'VEGAN'],
  EGG: ['VEG', 'VEGAN', 'EGG'],
  NON_VEG: ['VEG', 'VEGAN', 'EGG', 'NON_VEG'],
});
export const PURE_VEG_FOOD_TYPES = Object.freeze(['VEG', 'VEGAN']);

export const LIMITS = Object.freeze({
  minVariants: 2,
  maxVariants: 20,
  maxAddonGroups: 20,
  maxAddonsPerGroup: 50,
  maxImages: 10,
  maxSchedules: 21,
});

/**
 * @param {{
 *   foodType: string,
 *   basePricePaise?: number | null,
 *   variants?: { name: string, basePricePaise: number, isDefault?: boolean }[],
 *   addonGroups?: { name: string, minSelect: number, maxSelect: number, addons: { name: string, foodType?: string }[] }[],
 *   imageMediaIds?: string[],
 * }} product
 * @param {{ pureVeg?: boolean }} [restaurant]
 * @returns {Record<string, string[]>}
 */
export function validateProductStructure(product, restaurant = {}) {
  /** @type {Record<string, string[]>} */
  const errors = {};
  const add = (key, msg) => (errors[key] ??= []).push(msg);
  const variants = product.variants ?? [];
  const groups = product.addonGroups ?? [];

  if (restaurant.pureVeg && !PURE_VEG_FOOD_TYPES.includes(product.foodType))
    add('foodType', 'This restaurant is pure veg: products must be veg or vegan');

  if (variants.length) {
    if (variants.length < LIMITS.minVariants)
      add('variants', 'Add at least two variants, or remove variants and set one price');
    if (variants.length > LIMITS.maxVariants) add('variants', `At most ${LIMITS.maxVariants} variants`);
    const defaults = variants.filter((v) => v.isDefault).length;
    if (defaults !== 1) add('variants', 'Choose exactly one default variant');
    const names = new Map();
    variants.forEach((v, i) => {
      const key = v.name.trim().toLowerCase();
      if (names.has(key)) add(`variants.${i}.name`, 'Variant names must be different');
      names.set(key, i);
    });
  } else if (product.basePricePaise == null) {
    add('basePricePaise', 'Set a price (or add variants)');
  }

  if (groups.length > LIMITS.maxAddonGroups)
    add('addonGroups', `At most ${LIMITS.maxAddonGroups} add-on groups`);
  const allowed = COMPATIBLE_ADDON_FOOD_TYPES[product.foodType] ?? [];
  groups.forEach((g, gi) => {
    const n = g.addons?.length ?? 0;
    if (n < 1) add(`addonGroups.${gi}.addons`, 'Add at least one option');
    if (n > LIMITS.maxAddonsPerGroup)
      add(`addonGroups.${gi}.addons`, `At most ${LIMITS.maxAddonsPerGroup} options`);
    if (g.minSelect < 0) add(`addonGroups.${gi}.minSelect`, 'Cannot be negative');
    if (g.maxSelect < 1) add(`addonGroups.${gi}.maxSelect`, 'Must be at least 1');
    if (g.minSelect > g.maxSelect) add(`addonGroups.${gi}.minSelect`, 'Minimum cannot exceed maximum');
    if (n && g.maxSelect > n)
      add(`addonGroups.${gi}.maxSelect`, `Cannot exceed the number of options (${n})`);
    const names = new Set();
    (g.addons ?? []).forEach((a, ai) => {
      const type = a.foodType ?? 'VEG';
      if (!allowed.includes(type))
        add(
          `addonGroups.${gi}.addons.${ai}.foodType`,
          `A ${label(product.foodType)} item cannot have ${label(type)} add-ons`,
        );
      if (restaurant.pureVeg && !PURE_VEG_FOOD_TYPES.includes(type))
        add(`addonGroups.${gi}.addons.${ai}.foodType`, 'This restaurant is pure veg');
      const key = a.name.trim().toLowerCase();
      if (names.has(key)) add(`addonGroups.${gi}.addons.${ai}.name`, 'Option names must be different');
      names.add(key);
    });
  });

  const images = product.imageMediaIds ?? [];
  if (images.length > LIMITS.maxImages) add('imageMediaIds', `At most ${LIMITS.maxImages} images`);
  if (new Set(images).size !== images.length) add('imageMediaIds', 'The same image is added twice');
  return errors;
}

/** Base price a product with variants exposes: its default variant's (D-37). */
export function effectiveBasePrice(product) {
  const variants = product.variants ?? [];
  if (!variants.length) return product.basePricePaise;
  return (variants.find((v) => v.isDefault) ?? variants[0]).basePricePaise;
}

const label = (t) =>
  ({ VEG: 'veg', VEGAN: 'vegan', EGG: 'egg', NON_VEG: 'non-veg' })[t] ?? String(t).toLowerCase();
