import { describe, expect, it } from 'vitest';
import {
  branchOpenState,
  effectiveBasePrice,
  endOfLocalDay,
  localTime,
  parseHHmm,
  productAvailability,
  validateProductStructure,
  validateWeeklyRows,
  weeklyState,
} from './index.js';

const TZ = 'Asia/Kolkata';
// 2026-09-28 is a Monday (dayOfWeek 1). IST = UTC+05:30, no daylight saving.
const ist = (local) => new Date(`${local}+05:30`);
const MON = 1;
const TUE = 2;
const SAT = 6;
const SUN = 0;
const lunchAndDinner = [
  { dayOfWeek: MON, opensAt: '11:00', closesAt: '15:00' },
  { dayOfWeek: MON, opensAt: '18:00', closesAt: '23:00' },
];

describe('time helpers', () => {
  it('parses HH:mm and 24:00 only for closing times', () => {
    expect(parseHHmm('00:00')).toBe(0);
    expect(parseHHmm('23:59')).toBe(1439);
    expect(parseHHmm('24:00')).toBeNull();
    expect(parseHHmm('24:00', { allowEndOfDay: true })).toBe(1440);
    expect(parseHHmm('7:00')).toBeNull();
    expect(parseHHmm('12:60')).toBeNull();
  });

  it('reads local weekday and minute in the city timezone', () => {
    // 2026-09-27 20:00 UTC = Monday 01:30 IST
    expect(localTime(new Date('2026-09-27T20:00:00Z'), TZ)).toEqual({
      dayOfWeek: MON,
      minute: 90,
      weekMinute: 1530,
    });
  });

  it('end of local day is the next IST midnight', () => {
    expect(endOfLocalDay(ist('2026-09-28T13:45:10'), TZ).toISOString()).toBe(
      ist('2026-09-29T00:00:00').toISOString(),
    );
  });
});

describe('weekly rows validation', () => {
  it('accepts lunch + dinner, past-midnight and 24:00', () => {
    expect(validateWeeklyRows(lunchAndDinner)).toEqual({});
    expect(validateWeeklyRows([{ dayOfWeek: SAT, opensAt: '20:00', closesAt: '02:00' }])).toEqual({});
    expect(validateWeeklyRows([{ dayOfWeek: SUN, opensAt: '00:00', closesAt: '24:00' }])).toEqual({});
  });

  it('rejects bad times, equal times and overlaps (including a past-midnight spill)', () => {
    expect(validateWeeklyRows([{ dayOfWeek: MON, opensAt: '25:00', closesAt: '26:00' }])).toHaveProperty(
      '0.start',
    );
    expect(validateWeeklyRows([{ dayOfWeek: MON, opensAt: '10:00', closesAt: '10:00' }])).toHaveProperty(
      '0.end',
    );
    expect(validateWeeklyRows([{ dayOfWeek: 7, opensAt: '10:00', closesAt: '11:00' }])).toHaveProperty(
      '0.dayOfWeek',
    );
    expect(
      validateWeeklyRows([
        { dayOfWeek: MON, opensAt: '11:00', closesAt: '15:00' },
        { dayOfWeek: MON, opensAt: '14:00', closesAt: '16:00' },
      ]),
    ).toHaveProperty('1.start');
    // Monday 22:00–02:00 spills into Tuesday 01:00–03:00
    expect(
      validateWeeklyRows([
        { dayOfWeek: MON, opensAt: '22:00', closesAt: '02:00' },
        { dayOfWeek: TUE, opensAt: '01:00', closesAt: '03:00' },
      ]),
    ).toHaveProperty('1.start');
    // Saturday 23:00–01:00 wraps into Sunday 00:30
    expect(
      validateWeeklyRows([
        { dayOfWeek: SAT, opensAt: '23:00', closesAt: '01:00' },
        { dayOfWeek: SUN, opensAt: '00:30', closesAt: '05:00' },
      ]),
    ).toHaveProperty('1.start');
  });
});

describe('weeklyState', () => {
  it('open inside an interval with its closing time', () => {
    const s = weeklyState(lunchAndDinner, ist('2026-09-28T12:30:00'), TZ);
    expect(s.open).toBe(true);
    expect(s.closesAt.toISOString()).toBe(ist('2026-09-28T15:00:00').toISOString());
  });

  it('closed between intervals, with the next opening', () => {
    const s = weeklyState(lunchAndDinner, ist('2026-09-28T16:10:00'), TZ);
    expect(s.open).toBe(false);
    expect(s.nextOpenAt.toISOString()).toBe(ist('2026-09-28T18:00:00').toISOString());
    expect(s.nextOpenLocal).toEqual({ dayOfWeek: MON, time: '18:00' });
  });

  it('opening boundary is inclusive, closing boundary exclusive', () => {
    expect(weeklyState(lunchAndDinner, ist('2026-09-28T11:00:00'), TZ).open).toBe(true);
    expect(weeklyState(lunchAndDinner, ist('2026-09-28T15:00:00'), TZ).open).toBe(false);
  });

  it('next opening a week later when the only day has passed', () => {
    const s = weeklyState(lunchAndDinner, ist('2026-09-28T23:30:00'), TZ);
    expect(s.nextOpenAt.toISOString()).toBe(ist('2026-10-05T11:00:00').toISOString());
  });

  it('past-midnight hours belong to the opening day', () => {
    const late = [{ dayOfWeek: SAT, opensAt: '20:00', closesAt: '02:00' }];
    // Sunday 01:00 is still Saturday's opening (2026-10-03 is a Saturday)
    const s = weeklyState(late, ist('2026-10-04T01:00:00'), TZ);
    expect(s.open).toBe(true);
    expect(s.closesAt.toISOString()).toBe(ist('2026-10-04T02:00:00').toISOString());
    expect(weeklyState(late, ist('2026-10-04T02:00:00'), TZ).open).toBe(false);
  });

  it('adjacent intervals across midnight read as one continuous opening', () => {
    const rows = [
      { dayOfWeek: MON, opensAt: '18:00', closesAt: '24:00' },
      { dayOfWeek: TUE, opensAt: '00:00', closesAt: '02:00' },
    ];
    const s = weeklyState(rows, ist('2026-09-28T23:00:00'), TZ);
    expect(s.closesAt.toISOString()).toBe(ist('2026-09-29T02:00:00').toISOString());
  });

  it('24 × 7 has no closing time', () => {
    const rows = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, opensAt: '00:00', closesAt: '24:00' }));
    expect(weeklyState(rows, ist('2026-09-28T03:00:00'), TZ)).toMatchObject({ open: true, closesAt: null });
  });

  it('no rows = closed with no next opening', () => {
    expect(weeklyState([], ist('2026-09-28T12:00:00'), TZ)).toMatchObject({
      open: false,
      hasHours: false,
      nextOpenAt: null,
    });
  });
});

describe('branchOpenState', () => {
  const now = ist('2026-09-28T12:00:00');
  const branch = { restaurantStatus: 'ACTIVE', isOpen: true, pausedUntil: null, hours: lunchAndDinner };

  it('open', () => expect(branchOpenState(branch, now, TZ)).toMatchObject({ open: true, reason: 'OPEN' }));
  it('restaurant not active wins', () =>
    expect(branchOpenState({ ...branch, restaurantStatus: 'APPROVED' }, now, TZ).reason).toBe(
      'RESTAURANT_NOT_ACTIVE',
    ));
  it('manually closed', () =>
    expect(branchOpenState({ ...branch, isOpen: false }, now, TZ).reason).toBe('CLOSED_MANUALLY'));
  it('paused until a time, then open again', () => {
    const paused = { ...branch, pausedUntil: ist('2026-09-28T12:30:00') };
    expect(branchOpenState(paused, now, TZ)).toMatchObject({ open: false, reason: 'PAUSED' });
    expect(branchOpenState(paused, ist('2026-09-28T12:30:00'), TZ).open).toBe(true);
  });
  it('no hours', () => expect(branchOpenState({ ...branch, hours: [] }, now, TZ).reason).toBe('NO_HOURS'));
  it('outside hours', () =>
    expect(branchOpenState(branch, ist('2026-09-28T16:00:00'), TZ)).toMatchObject({
      reason: 'OUTSIDE_HOURS',
      nextOpenLocal: { dayOfWeek: MON, time: '18:00' },
    }));
});

describe('productAvailability', () => {
  const now = ist('2026-09-28T12:00:00');
  const base = {
    status: 'ACTIVE',
    isAvailable: true,
    stockQuantity: null,
    windows: [],
    schedules: [],
    variants: [],
  };

  it('available by default', () =>
    expect(productAvailability(base, now, TZ)).toMatchObject({ available: true, reason: 'AVAILABLE' }));
  it('draft and archived are never available', () => {
    expect(productAvailability({ ...base, status: 'DRAFT' }, now, TZ).reason).toBe('DRAFT');
    expect(productAvailability({ ...base, status: 'ARCHIVED' }, now, TZ).reason).toBe('ARCHIVED');
  });
  it('indefinite sold-out switch', () =>
    expect(productAvailability({ ...base, isAvailable: false }, now, TZ).reason).toBe('SOLD_OUT'));
  it('sold out until the end of a window, then available', () => {
    const windows = [
      { isAvailable: false, startsAt: ist('2026-09-28T10:00:00'), endsAt: ist('2026-09-29T00:00:00') },
    ];
    const r = productAvailability({ ...base, windows }, now, TZ);
    expect(r).toMatchObject({ available: false, reason: 'SOLD_OUT_UNTIL' });
    expect(r.until.toISOString()).toBe(ist('2026-09-29T00:00:00').toISOString());
    expect(productAvailability({ ...base, windows }, ist('2026-09-29T00:00:00'), TZ).available).toBe(true);
  });
  it('the latest window wins', () => {
    const windows = [
      { isAvailable: false, startsAt: ist('2026-09-28T09:00:00'), endsAt: null },
      { isAvailable: true, startsAt: ist('2026-09-28T11:00:00'), endsAt: null },
    ];
    expect(productAvailability({ ...base, windows }, now, TZ).available).toBe(true);
  });
  it('a future window has no effect yet', () => {
    const windows = [{ isAvailable: false, startsAt: ist('2026-09-28T13:00:00'), endsAt: null }];
    expect(productAvailability({ ...base, windows }, now, TZ).available).toBe(true);
  });
  it('stock', () => {
    expect(productAvailability({ ...base, stockQuantity: 0 }, now, TZ).reason).toBe('OUT_OF_STOCK');
    expect(productAvailability({ ...base, stockQuantity: 3 }, now, TZ).available).toBe(true);
  });
  it('all variants unavailable', () =>
    expect(
      productAvailability({ ...base, variants: [{ isAvailable: false }, { isAvailable: false }] }, now, TZ)
        .reason,
    ).toBe('NO_VARIANT_AVAILABLE'));
  it('outside its schedule, with the next time it can be ordered', () => {
    const schedules = [{ dayOfWeek: MON, startsAt: '07:00', endsAt: '11:00' }];
    const r = productAvailability({ ...base, schedules }, now, TZ);
    expect(r.reason).toBe('OUTSIDE_SCHEDULE');
    expect(r.nextAvailableAt.toISOString()).toBe(ist('2026-10-05T07:00:00').toISOString());
    expect(productAvailability({ ...base, schedules }, ist('2026-09-28T08:00:00'), TZ).available).toBe(true);
  });
});

describe('validateProductStructure', () => {
  const ok = { foodType: 'VEG', basePricePaise: 15000, variants: [], addonGroups: [], imageMediaIds: [] };
  const group = (addons, min = 0, max = 1) => ({ name: 'Extras', minSelect: min, maxSelect: max, addons });

  it('a simple priced product is valid', () => expect(validateProductStructure(ok)).toEqual({}));
  it('needs a price when there are no variants', () =>
    expect(validateProductStructure({ ...ok, basePricePaise: null })).toHaveProperty('basePricePaise'));
  it('variants: at least two, exactly one default, distinct names', () => {
    expect(
      validateProductStructure({ ...ok, variants: [{ name: 'Only', basePricePaise: 1, isDefault: true }] }),
    ).toHaveProperty('variants');
    const two = [
      { name: 'Half', basePricePaise: 9000, isDefault: false },
      { name: 'Full', basePricePaise: 15000, isDefault: false },
    ];
    expect(validateProductStructure({ ...ok, variants: two }).variants).toContain(
      'Choose exactly one default variant',
    );
    const dup = [
      { name: 'Half', basePricePaise: 9000, isDefault: true },
      { name: ' half ', basePricePaise: 15000, isDefault: false },
    ];
    expect(validateProductStructure({ ...ok, variants: dup })).toHaveProperty('variants.1.name');
  });
  it('add-on group limits', () => {
    expect(validateProductStructure({ ...ok, addonGroups: [group([])] })).toHaveProperty(
      'addonGroups.0.addons',
    );
    expect(
      validateProductStructure({ ...ok, addonGroups: [group([{ name: 'Cheese' }], 0, 2)] }),
    ).toHaveProperty('addonGroups.0.maxSelect');
    expect(
      validateProductStructure({ ...ok, addonGroups: [group([{ name: 'A' }, { name: 'B' }], 2, 1)] }),
    ).toHaveProperty('addonGroups.0.minSelect');
    expect(
      validateProductStructure({
        ...ok,
        addonGroups: [group([{ name: 'Regular' }, { name: 'Jain' }], 1, 1)],
      }),
    ).toEqual({});
  });
  it('food-type consistency', () => {
    const egg = group([{ name: 'Egg', foodType: 'EGG' }]);
    expect(validateProductStructure({ ...ok, addonGroups: [egg] })).toHaveProperty(
      'addonGroups.0.addons.0.foodType',
    );
    expect(validateProductStructure({ ...ok, foodType: 'EGG', addonGroups: [egg] })).toEqual({});
    expect(
      validateProductStructure({
        ...ok,
        foodType: 'VEGAN',
        addonGroups: [group([{ name: 'Paneer', foodType: 'VEG' }])],
      }),
    ).toHaveProperty('addonGroups.0.addons.0.foodType');
  });
  it('pure-veg restaurants accept only veg and vegan', () => {
    expect(validateProductStructure({ ...ok, foodType: 'EGG' }, { pureVeg: true })).toHaveProperty(
      'foodType',
    );
    expect(validateProductStructure(ok, { pureVeg: true })).toEqual({});
  });
  it('images: at most 10, no duplicates', () => {
    expect(validateProductStructure({ ...ok, imageMediaIds: ['a', 'a'] })).toHaveProperty('imageMediaIds');
    expect(
      validateProductStructure({ ...ok, imageMediaIds: Array.from({ length: 11 }, (_, i) => `m${i}`) }),
    ).toHaveProperty('imageMediaIds');
  });
  it('effective base price is the default variant', () => {
    expect(effectiveBasePrice({ basePricePaise: 1, variants: [] })).toBe(1);
    expect(
      effectiveBasePrice({
        basePricePaise: 1,
        variants: [
          { basePricePaise: 9000, isDefault: false },
          { basePricePaise: 15000, isDefault: true },
        ],
      }),
    ).toBe(15000);
  });
});
