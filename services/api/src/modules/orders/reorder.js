// "Order again" (D-116): a past order's items rebuilt against today's menu. Prices are not copied — the cart is
// re-quoted by the server as usual; dishes that cannot be ordered the same way any more are left out and listed.

/**
 * @param {any} order the order with `items` (and their `addons`)
 * @param {any[]} products the restaurant's current products for those items, with `variants` and
 *   `addonGroups.addons`
 * @returns {{ lines: any[], skipped: { name: string, reason: 'REMOVED' | 'SOLD_OUT' | 'OPTIONS_CHANGED' }[] }}
 */
export function rebuildCart(order, products) {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [];
  /** @type {{ name: string, reason: 'REMOVED' | 'SOLD_OUT' | 'OPTIONS_CHANGED' }[]} */
  const skipped = [];
  for (const item of order.items) {
    const name = item.variantName ? `${item.productName} (${item.variantName})` : item.productName;
    const p = byId.get(item.productId);
    if (!p || p.status !== 'ACTIVE' || p.restaurantId !== order.restaurantId) {
      skipped.push({ name, reason: 'REMOVED' });
      continue;
    }
    if (!p.isAvailable) {
      skipped.push({ name, reason: 'SOLD_OUT' });
      continue;
    }
    // Size: the same one if it still exists; an item ordered without a size cannot be guessed one now.
    const variant = item.variantId ? p.variants.find((v) => v.id === item.variantId) : null;
    if ((item.variantId && !variant) || (!item.variantId && p.variants.length)) {
      skipped.push({ name, reason: 'OPTIONS_CHANGED' });
      continue;
    }
    if (variant && !variant.isAvailable) {
      skipped.push({ name, reason: 'SOLD_OUT' });
      continue;
    }
    // Add-ons: every one still offered and available, and every group's minimum and maximum still met.
    const addonsById = new Map(p.addonGroups.flatMap((g) => g.addons.map((a) => [a.id, { ...a, group: g }])));
    const chosen = item.addons.map((a) => addonsById.get(a.addonId));
    if (chosen.some((a) => !a)) {
      skipped.push({ name, reason: 'OPTIONS_CHANGED' });
      continue;
    }
    if (chosen.some((a) => !a.isAvailable)) {
      skipped.push({ name, reason: 'SOLD_OUT' });
      continue;
    }
    const groupsOk = p.addonGroups.every((g) => {
      const n = chosen.filter((a) => a.group.id === g.id).length;
      return n >= g.minSelect && n <= g.maxSelect;
    });
    if (!groupsOk) {
      skipped.push({ name, reason: 'OPTIONS_CHANGED' });
      continue;
    }
    lines.push({
      productId: p.id,
      variantId: variant?.id ?? null,
      addonIds: chosen.map((a) => a.id),
      quantity: item.quantity,
      name: p.name,
      variantName: variant?.name ?? null,
      addonNames: chosen.map((a) => a.name),
      foodType: p.foodType,
    });
  }
  return { lines, skipped };
}

/** "Margherita × 2, Garlic Bread" — what was ordered, for the Home "Order again" cards. */
export const itemsSummary = (items) =>
  items.map((i) => (i.quantity > 1 ? `${i.productName} × ${i.quantity}` : i.productName)).join(', ');
