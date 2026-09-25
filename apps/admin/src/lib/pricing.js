// Presentation helpers for pricing rules. The API validates and the engine computes; nothing here does money math.
import { formatPaise } from '@jamzo/ui';

export const RULE_TYPES = [
  {
    value: 'MARKUP',
    label: 'Markup',
    permission: 'pricing.manage',
    help: 'Customer price above the restaurant’s price. Legality and disclosure pending (Q-4).',
  },
  {
    value: 'COMMISSION',
    label: 'Commission',
    permission: 'commissions.manage',
    help: 'What Jamzo charges restaurants; the basis (before/after discounts) is part of each rule.',
  },
  {
    value: 'TAX',
    label: 'Tax',
    permission: 'taxes.manage',
    help: 'GST per charge and withholdings. Every value is pending CA review (Q-3).',
  },
  {
    value: 'DELIVERY',
    label: 'Delivery fee',
    permission: 'pricing.manage',
    help: 'Distance slabs or per-km, free-delivery threshold and small-order fee.',
  },
  {
    value: 'PLATFORM_FEE',
    label: 'Platform fee',
    permission: 'pricing.manage',
    help: 'Fixed and/or percentage fee per order, optionally on a schedule.',
  },
  {
    value: 'SURGE',
    label: 'Surcharges',
    permission: 'pricing.surge',
    help: 'Night, demand, weather and manual surcharges with an instant on/off switch.',
  },
  {
    value: 'RIDER_EARNING',
    label: 'Rider pay',
    permission: 'pricing.manage',
    help: 'Estimated delivery partner pay per order (final pay is computed at delivery, Phase 6).',
  },
];
export const ruleTypeLabel = (t) => RULE_TYPES.find((r) => r.value === t)?.label ?? t;

export const SCOPES = [
  { value: 'GLOBAL', label: 'All cities' },
  { value: 'CITY', label: 'City' },
  { value: 'ZONE', label: 'Zone' },
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'CATEGORY', label: 'Food category' },
  { value: 'PRODUCT', label: 'Product' },
];
/** Which scopes each rule type accepts (mirrors the API; the API has the final say). */
export const scopesFor = (type, appliesTo) =>
  SCOPES.filter((s) => {
    if (!['CATEGORY', 'PRODUCT'].includes(s.value)) return true;
    return type === 'MARKUP' || type === 'COMMISSION' || (type === 'TAX' && appliesTo === 'FOOD');
  });

export const pct = (bps) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const rupees = (p) => (p == null ? '—' : formatPaise(p));

/** One-line human summary of a rule's parameters. */
export function summarize(type, p) {
  if (!p) return '';
  switch (type) {
    case 'MARKUP':
      return `${p.type === 'PERCENTAGE' ? `+${pct(p.valueBps)}` : `+${rupees(p.valuePaise)}`}${p.rounding?.mode && p.rounding.mode !== 'NONE' ? ` · round ${p.rounding.mode.replace('NEAREST_', 'to ₹').toLowerCase()}` : ''}${p.applyToAddons === false ? ' · not on add-ons' : ''}`;
    case 'COMMISSION': {
      const basis = {
        PRE_DISCOUNT: 'before discounts',
        POST_RESTAURANT_DISCOUNT: 'after restaurant-funded discounts',
        POST_ALL_DISCOUNTS: 'after all discounts',
      }[p.basis];
      const v =
        p.type === 'PERCENTAGE'
          ? pct(p.rateBps)
          : p.type === 'FIXED'
            ? rupees(p.fixedPaise)
            : `${pct(p.rateBps)} ${p.hybridMode === 'MAX' ? 'or' : '+'} ${rupees(p.fixedPaise)}`;
      return `${v} · ${basis}`;
    }
    case 'TAX':
      if (p.appliesTo === 'WITHHOLDING')
        return `${p.kind} ${pct(p.rateBps)} on ${p.base === 'FOOD_VALUE' ? 'food value' : 'food value after restaurant discounts'} · ${p.enabled ? 'on' : 'off'}`;
      return `${p.appliesTo.replace(/_/g, ' ').toLowerCase()}: ${p.mode === 'EXEMPT' ? 'exempt' : `${p.components.map((c) => `${c.code} ${pct(c.rateBps)}`).join(' + ')} ${p.mode.toLowerCase()}`}`;
    case 'DELIVERY': {
      const base =
        p.strategy === 'SLABS'
          ? p.slabs.map((s) => `≤${(s.upToM / 1000).toFixed(1)} km ${rupees(s.feePaise)}`).join(', ')
          : p.strategy === 'FLAT'
            ? `flat ${rupees(p.flatPaise)}`
            : `${rupees(p.basePaise)} incl. ${(p.includedM / 1000).toFixed(1)} km + ${rupees(p.perKmPaise)}/km`;
      return `${base} · max ${(p.maxDistanceM / 1000).toFixed(1)} km${p.freeAboveSubtotalPaise ? ` · free above ${rupees(p.freeAboveSubtotalPaise)}` : ''}${p.smallOrder ? ` · small order ${rupees(p.smallOrder.feePaise)} below ${rupees(p.smallOrder.belowSubtotalPaise)}` : ''}`;
    }
    case 'PLATFORM_FEE':
      return p.enabled
        ? [p.fixedPaise ? rupees(p.fixedPaise) : null, p.rateBps ? pct(p.rateBps) : null]
            .filter(Boolean)
            .join(' + ') || '₹0'
        : 'Off';
    case 'SURGE':
      return `${p.type === 'FIXED' ? rupees(p.value) : p.type === 'PERCENTAGE' ? `${pct(p.value)} of delivery fee` : `×${(p.value / 10000).toFixed(2)} delivery fee`}${p.window ? ` · ${p.window.start}–${p.window.end}` : ' · all day'}`;
    case 'RIDER_EARNING':
      return `${rupees(p.basePaise)} incl. ${(p.includedM / 1000).toFixed(1)} km + ${rupees(p.perKmPaise)}/km${p.incentives?.length ? ` · ${p.incentives.map((i) => `${i.kind.toLowerCase()} +${i.type === 'FIXED' ? rupees(i.value) : pct(i.value)}`).join(', ')}` : ''}`;
    default:
      return JSON.stringify(p);
  }
}

/** "12.5" → 1250 bps, exactly (no floating point). Null when not a valid percentage with ≤ 2 decimals. */
export function parsePercentToBps(text) {
  const m = /^(\d{1,4})(?:\.(\d{0,2}))?$/.exec(String(text ?? '').trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null;
}
/** "2.5" km → 2500 m, exactly. */
export function parseKmToMetres(text) {
  const m = /^(\d{1,3})(?:\.(\d{0,3}))?$/.exec(String(text ?? '').trim());
  return m ? Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0')) : null;
}
export const bpsToPercentText = (bps) => (bps == null ? '' : String(bps / 100));
export const metresToKmText = (m) => (m == null ? '' : String(m / 1000));
