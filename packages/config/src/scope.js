// Hierarchical configuration resolution (PRICING.md §2, CONFIGURATION.md §2). One implementation for
// every rule type and setting: the most specific applicable candidate wins — as a whole.

/** Rank per scope; higher = more specific. CATEGORY with a restaurant qualifier ranks 6.5. */
export const SCOPE_RANK = Object.freeze({
  GLOBAL: 0,
  COUNTRY: 1,
  STATE: 2,
  CITY: 3,
  ZONE: 4,
  RESTAURANT: 5,
  BRANCH: 5.5,
  CATEGORY: 6,
  PRODUCT: 7,
  VARIANT: 8,
});

/** Which context field a scope's `scopeRefId` must equal. */
const CONTEXT_KEY = Object.freeze({
  COUNTRY: 'countryId',
  STATE: 'stateId',
  CITY: 'cityId',
  ZONE: 'zoneId',
  RESTAURANT: 'restaurantId',
  BRANCH: 'branchId',
  CATEGORY: 'categoryId',
  PRODUCT: 'productId',
  VARIANT: 'variantId',
});

/**
 * @typedef {object} ScopeContext
 * @property {string} [countryId]
 * @property {string} [stateId]
 * @property {string} [cityId]
 * @property {string} [zoneId]
 * @property {string} [restaurantId]
 * @property {string} [branchId]
 * @property {string} [categoryId]
 * @property {string} [productId]
 * @property {string} [variantId]
 */

/**
 * @typedef {object} ScopedCandidate
 * @property {string} id
 * @property {keyof typeof SCOPE_RANK} scope
 * @property {string | null} [scopeRefId]
 * @property {string | null} [restaurantId] qualifier (CATEGORY rules limited to one restaurant)
 * @property {number} [priority]
 * @property {Date | string | null} [effectiveFrom]
 * @property {Date | string | null} [effectiveTo]
 */

const time = (/** @type {Date|string|null|undefined} */ v) => (v == null ? null : new Date(v).getTime());

/**
 * Rank of a candidate for a context, or null when it does not apply.
 * @param {ScopedCandidate} c
 * @param {ScopeContext} ctx
 */
export function candidateRank(c, ctx) {
  if (!(c.scope in SCOPE_RANK)) throw new Error(`Unknown scope ${c.scope}`);
  if (c.scope === 'GLOBAL') return c.scopeRefId == null ? 0 : null;
  const key = CONTEXT_KEY[c.scope];
  if (c.scopeRefId == null || ctx[key] == null || c.scopeRefId !== ctx[key]) return null;
  if (c.scope === 'CATEGORY' && c.restaurantId != null) {
    return c.restaurantId === ctx.restaurantId ? 6.5 : null;
  }
  return SCOPE_RANK[c.scope];
}

/**
 * Pick the winning candidate. Deterministic tie-break: rank ▸ priority ▸ later effectiveFrom ▸ id.
 * @template {ScopedCandidate} T
 * @param {T[]} candidates
 * @param {ScopeContext} ctx
 * @param {Date} [at] evaluation instant; candidates outside [effectiveFrom, effectiveTo) are ignored
 * @returns {{ winner: T, rank: number, inheritedFrom: string } | null}
 */
export function resolveScoped(candidates, ctx, at) {
  const now = at ? at.getTime() : null;
  let best = null;
  for (const c of candidates) {
    const rank = candidateRank(c, ctx);
    if (rank === null) continue;
    if (now !== null) {
      const from = time(c.effectiveFrom);
      const to = time(c.effectiveTo);
      if (from !== null && from > now) continue;
      if (to !== null && now >= to) continue;
    }
    if (!best || compare(c, rank, best.winner, best.rank) > 0) best = { winner: c, rank };
  }
  return best ? { ...best, inheritedFrom: best.winner.scope } : null;
}

/** @returns {number} positive if (a, ra) should win over (b, rb) */
function compare(a, ra, b, rb) {
  if (ra !== rb) return ra - rb;
  const pa = a.priority ?? 0;
  const pb = b.priority ?? 0;
  if (pa !== pb) return pa - pb;
  const fa = time(a.effectiveFrom) ?? 0;
  const fb = time(b.effectiveFrom) ?? 0;
  if (fa !== fb) return fa - fb;
  return a.id === b.id ? 0 : a.id > b.id ? 1 : -1;
}

/**
 * The (scope, scopeRefId) pairs that can apply to a context — used to query candidate rows.
 * @param {ScopeContext} ctx
 * @returns {{ scope: string, scopeRefId: string | null }[]}
 */
export function scopeTargets(ctx) {
  const out = [{ scope: 'GLOBAL', scopeRefId: null }];
  for (const [scope, key] of Object.entries(CONTEXT_KEY)) {
    if (ctx[key]) out.push({ scope, scopeRefId: ctx[key] });
  }
  return out;
}
