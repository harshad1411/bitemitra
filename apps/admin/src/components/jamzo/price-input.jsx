import { Input } from '@/components/ui/input';

/**
 * Rupee amount field. Holds the typed text; forms convert with parseRupeesToPaise (@jamzo/ui), which is
 * exact — no floating-point money anywhere.
 */
export function PriceInput({ value, onChange, className, ...props }) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
        ₹
      </span>
      <Input
        {...props}
        inputMode="decimal"
        className="pl-6 tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
