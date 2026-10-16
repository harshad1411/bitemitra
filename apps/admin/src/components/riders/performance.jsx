'use client';

// Delivery partner performance pieces (D-113): India-date ranges and the figures table.
import { formatPaise } from '@jamzo/ui';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const DAY = 86_400_000;
/** India date (YYYY-MM-DD). */
export const indiaDay = (d) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const plus = (day, n) => indiaDay(new Date(Date.parse(`${day}T00:00:00+05:30`) + n * DAY));

/** Preset ranges in India time; `to` is the day after the last day shown. */
export function presetRange(preset, now = new Date()) {
  const today = indiaDay(now);
  if (preset === 'YESTERDAY') return { from: plus(today, -1), to: today };
  if (preset === 'WEEK') {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    return { from: plus(today, -((weekday + 6) % 7)), to: plus(today, 1) };
  }
  if (preset === 'MONTH') return { from: `${today.slice(0, 8)}01`, to: plus(today, 1) };
  if (preset === 'LAST30') return { from: plus(today, -29), to: plus(today, 1) };
  return { from: today, to: plus(today, 1) };
}

const PRESETS = [
  ['TODAY', 'Today'],
  ['YESTERDAY', 'Yesterday'],
  ['WEEK', 'This week'],
  ['MONTH', 'This month'],
  ['LAST30', 'Last 30 days'],
];

/** Preset tabs plus editable from / to (the "to" field shows the last day included). */
export function RangePicker({ preset, range, onChange }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Tabs value={preset} onValueChange={(p) => onChange(p, presetRange(p))}>
        <TabsList>
          {PRESETS.map(([v, l]) => (
            <TabsTrigger key={v} value={v}>
              {l}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <label className="grid gap-1 text-xs text-muted-foreground">
        From
        <Input
          type="date"
          aria-label="From"
          value={range.from}
          onChange={(e) => e.target.value && onChange('CUSTOM', { ...range, from: e.target.value })}
          className="w-40"
        />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        To
        <Input
          type="date"
          aria-label="To"
          value={plus(range.to, -1)}
          onChange={(e) => e.target.value && onChange('CUSTOM', { ...range, to: plus(e.target.value, 1) })}
          className="w-40"
        />
      </label>
    </div>
  );
}

export const hours = (m) => (m ? `${Math.floor(m / 60)} h ${m % 60} min` : '—');
export const stars = (r) => (r.average == null ? '—' : `${r.average.toFixed(1)}★ (${r.count})`);
export const money = (p) => formatPaise(p);

/** Columns shared by the all-partners table and the day-by-day table. */
export const FIGURES = [
  ['Deliveries', (r) => String(r.deliveries)],
  ['Cancelled trips', (r) => String(r.cancelledTrips)],
  ['Offers declined / missed', (r) => `${r.offersRejected} / ${r.offersTimedOut}`],
  ['Partner pay', (r) => money(r.payPaise)],
  ['Tips', (r) => money(r.tipsPaise)],
  ['Cash collected', (r) => money(r.cashCollectedPaise)],
  ['Delivery charges', (r) => money(r.deliveryChargesPaise)],
  ['Jamzo margin', (r) => money(r.marginPaise)],
  ['Avg trip', (r) => (r.averageTripMinutes == null ? '—' : `${r.averageTripMinutes} min`)],
  ['Online', (r) => hours(r.onlineMinutes)],
  ['Rating', (r) => stars(r.rating)],
];
