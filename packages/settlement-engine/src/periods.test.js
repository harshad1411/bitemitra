import { describe, expect, it } from 'vitest';
import { localDate, nextRunAt, settlementPeriod } from './periods.js';
import { riderNetting, riderPosition } from './netting.js';

const TZ = 'Asia/Kolkata';
const ist = (local) => new Date(`${local}+05:30`);
const iso = (p) => p && { start: p.start.toISOString(), end: p.end.toISOString() };

describe('settlement periods in India time', () => {
  // Monday 28 Sep 2026, 06:00 IST
  const MON = ist('2026-09-28T06:00:00');

  it('daily / T+1 cover yesterday; T+2 the day before', () => {
    expect(iso(settlementPeriod('DAILY', MON, { timeZone: TZ }))).toEqual({
      start: ist('2026-09-27T00:00:00').toISOString(),
      end: ist('2026-09-28T00:00:00').toISOString(),
    });
    expect(iso(settlementPeriod('T_PLUS_1', MON, { timeZone: TZ }))).toEqual(
      iso(settlementPeriod('DAILY', MON, { timeZone: TZ })),
    );
    expect(iso(settlementPeriod('T_PLUS_2', MON, { timeZone: TZ }))).toEqual({
      start: ist('2026-09-26T00:00:00').toISOString(),
      end: ist('2026-09-27T00:00:00').toISOString(),
    });
  });

  it('weekly: the last full Monday–Sunday week, only on the run day', () => {
    expect(iso(settlementPeriod('WEEKLY', MON, { timeZone: TZ }))).toEqual({
      start: ist('2026-09-21T00:00:00').toISOString(),
      end: ist('2026-09-28T00:00:00').toISOString(),
    });
    expect(settlementPeriod('WEEKLY', ist('2026-09-29T06:00:00'), { timeZone: TZ })).toBeNull();
    // Run on Wednesday: still the last full week (Mon 21 – Sun 27).
    expect(
      iso(
        settlementPeriod('WEEKLY', ist('2026-09-30T06:00:00'), { timeZone: TZ, weeklyRunDay: 'WEDNESDAY' }),
      ),
    ).toEqual({
      start: ist('2026-09-21T00:00:00').toISOString(),
      end: ist('2026-09-28T00:00:00').toISOString(),
    });
    expect(settlementPeriod('MANUAL', MON, { timeZone: TZ })).toBeNull();
  });

  it('month and year edges, and just after midnight IST (still the previous UTC day)', () => {
    const p = settlementPeriod('DAILY', ist('2026-10-01T00:30:00'), { timeZone: TZ });
    expect(iso(p)).toEqual({
      start: ist('2026-09-30T00:00:00').toISOString(),
      end: ist('2026-10-01T00:00:00').toISOString(),
    });
    const y = settlementPeriod('DAILY', ist('2027-01-01T05:00:00'), { timeZone: TZ });
    expect(iso(y)).toEqual({
      start: ist('2026-12-31T00:00:00').toISOString(),
      end: ist('2027-01-01T00:00:00').toISOString(),
    });
    expect(localDate(ist('2026-10-01T00:30:00'), TZ)).toMatchObject({
      y: 2026,
      m: 10,
      d: 1,
      weekday: 'THURSDAY',
    });
  });

  it('the daily job runs at 06:00 IST', () => {
    expect(nextRunAt(ist('2026-09-28T05:59:00'), TZ).toISOString()).toBe(
      ist('2026-09-28T06:00:00').toISOString(),
    );
    expect(nextRunAt(ist('2026-09-28T06:00:00'), TZ).toISOString()).toBe(
      ist('2026-09-29T06:00:00').toISOString(),
    );
  });
});

describe('delivery partner netting', () => {
  it('cash held is taken from earnings; what is left is paid or still owed', () => {
    expect(riderNetting({ earningsPaise: 50_000, codHeldPaise: 20_000, netting: true })).toEqual({
      codNettedPaise: 20_000,
      payablePaise: 30_000,
      owesPaise: 0,
    });
    expect(riderNetting({ earningsPaise: 10_000, codHeldPaise: 25_000, netting: true })).toEqual({
      codNettedPaise: 10_000,
      payablePaise: 0,
      owesPaise: 15_000,
    });
    expect(riderNetting({ earningsPaise: 10_000, codHeldPaise: 25_000, netting: false })).toEqual({
      codNettedPaise: 0,
      payablePaise: 10_000,
      owesPaise: 25_000,
    });
    expect(riderPosition({ earningsPaise: 10_000, codHeldPaise: 25_000 })).toEqual({
      owesPaise: 15_000,
      owedPaise: 0,
    });
  });
});
