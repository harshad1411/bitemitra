import { cn } from 'cn';
import { statusTones } from '@jamzo/ui';

/**
 * Consistent status colours from design tokens (spec §61). tone: neutral | info | success | warning | critical | accent
 */
export function StatusBadge({ tone = 'neutral', children, className }) {
  const t = statusTones[tone] ?? statusTones.neutral;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {children}
    </span>
  );
}
