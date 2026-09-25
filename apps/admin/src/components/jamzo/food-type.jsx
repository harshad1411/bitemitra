import { statusTones } from '@jamzo/ui';

const TYPES = {
  VEG: { label: 'Veg', tone: 'success' },
  VEGAN: { label: 'Vegan', tone: 'success' },
  EGG: { label: 'Egg', tone: 'warning' },
  NON_VEG: { label: 'Non-veg', tone: 'critical' },
};
export const FOOD_TYPE_OPTIONS = Object.entries(TYPES).map(([value, t]) => ({ value, label: t.label }));

/** The familiar Indian veg / non-veg mark: a square outline with a dot, plus a text label for screen readers. */
export function FoodTypeMark({ type, showLabel = false }) {
  const t = TYPES[type] ?? TYPES.VEG;
  const color = statusTones[t.tone].fg;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
        <rect x="1" y="1" width="12" height="12" rx="2" fill="none" stroke={color} strokeWidth="1.5" />
        {type === 'NON_VEG' ? (
          <path d="M7 3.5 10.5 10h-7z" fill={color} />
        ) : (
          <circle cx="7" cy="7" r="3" fill={color} />
        )}
      </svg>
      <span className={showLabel ? undefined : 'sr-only'}>{t.label}</span>
    </span>
  );
}
