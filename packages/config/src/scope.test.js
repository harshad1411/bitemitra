import { describe, expect, it } from 'vitest';
import { resolveScoped, scopeTargets } from './scope.js';

const ctx = {
  countryId: 'in',
  stateId: 'gj',
  cityId: 'unjha',
  zoneId: 'z1',
  restaurantId: 'r1',
  branchId: 'b1',
  categoryId: 'desserts',
  productId: 'burger',
};

describe('resolveScoped — most specific applicable rule wins', () => {
  const rules = [
    { id: 'g', scope: 'GLOBAL', scopeRefId: null, value: 500 },
    { id: 'c', scope: 'CITY', scopeRefId: 'unjha', value: 700 },
    { id: 'r', scope: 'RESTAURANT', scopeRefId: 'r1', value: 1000 },
    { id: 'p', scope: 'PRODUCT', scopeRefId: 'burger', value: 1500 },
  ];

  it('spec §10 / OD-8 example: product override beats restaurant, city and global', () => {
    expect(resolveScoped(rules, ctx).winner.id).toBe('p');
    expect(resolveScoped(rules, { ...ctx, productId: 'garlic-bread' }).winner.id).toBe('r');
    expect(resolveScoped(rules, { cityId: 'unjha', restaurantId: 'r2' }).winner.id).toBe('c');
    expect(resolveScoped(rules, { cityId: 'mehsana' }).winner.id).toBe('g');
  });

  it('ignores rules targeting other entities', () => {
    const r = resolveScoped([{ id: 'x', scope: 'CITY', scopeRefId: 'ahmedabad' }], ctx);
    expect(r).toBeNull();
  });

  it('BRANCH sits between RESTAURANT and CATEGORY', () => {
    const rs = [
      { id: 'rest', scope: 'RESTAURANT', scopeRefId: 'r1' },
      { id: 'branch', scope: 'BRANCH', scopeRefId: 'b1' },
      { id: 'cat', scope: 'CATEGORY', scopeRefId: 'desserts' },
    ];
    expect(resolveScoped(rs.slice(0, 2), ctx).winner.id).toBe('branch');
    expect(resolveScoped(rs, ctx).winner.id).toBe('cat');
  });

  it('a restaurant-qualified CATEGORY rule beats an unqualified one and only applies to that restaurant', () => {
    const rs = [
      { id: 'cat-all', scope: 'CATEGORY', scopeRefId: 'desserts', restaurantId: null },
      { id: 'cat-r1', scope: 'CATEGORY', scopeRefId: 'desserts', restaurantId: 'r1' },
    ];
    expect(resolveScoped(rs, ctx).winner.id).toBe('cat-r1');
    expect(resolveScoped(rs, { ...ctx, restaurantId: 'r2' }).winner.id).toBe('cat-all');
  });

  it('respects effective windows (future-dated and expired rules are skipped)', () => {
    const at = new Date('2026-09-24T10:00:00Z');
    const rs = [
      { id: 'old', scope: 'CITY', scopeRefId: 'unjha', effectiveFrom: '2026-01-01', effectiveTo: '2026-09-01' },
      { id: 'current', scope: 'CITY', scopeRefId: 'unjha', effectiveFrom: '2026-09-01', effectiveTo: null },
      { id: 'future', scope: 'CITY', scopeRefId: 'unjha', effectiveFrom: '2026-10-01', effectiveTo: null },
    ];
    expect(resolveScoped(rs, ctx, at).winner.id).toBe('current');
    expect(resolveScoped(rs, ctx, new Date('2026-08-15T00:00:00Z')).winner.id).toBe('old');
    expect(resolveScoped(rs, ctx, new Date('2026-10-02T00:00:00Z')).winner.id).toBe('future');
    // effectiveTo is exclusive
    expect(resolveScoped(rs, ctx, new Date('2026-09-01T00:00:00Z')).winner.id).toBe('current');
  });

  it('breaks ties deterministically: priority, then later effectiveFrom, then id', () => {
    const rs = [
      { id: 'a', scope: 'CITY', scopeRefId: 'unjha', priority: 0, effectiveFrom: '2026-01-01' },
      { id: 'b', scope: 'CITY', scopeRefId: 'unjha', priority: 5, effectiveFrom: '2025-01-01' },
    ];
    expect(resolveScoped(rs, ctx).winner.id).toBe('b');
    const same = [
      { id: 'a', scope: 'CITY', scopeRefId: 'unjha', effectiveFrom: '2026-01-01' },
      { id: 'b', scope: 'CITY', scopeRefId: 'unjha', effectiveFrom: '2026-02-01' },
    ];
    expect(resolveScoped(same, ctx).winner.id).toBe('b');
    expect(resolveScoped([same[1], same[0]], ctx).winner.id).toBe('b');
  });

  it('GLOBAL rows must not carry a target', () => {
    expect(resolveScoped([{ id: 'bad', scope: 'GLOBAL', scopeRefId: 'x' }], ctx)).toBeNull();
  });

  it('lists the targets that can apply', () => {
    expect(scopeTargets({ cityId: 'unjha', zoneId: 'z1' })).toEqual([
      { scope: 'GLOBAL', scopeRefId: null },
      { scope: 'CITY', scopeRefId: 'unjha' },
      { scope: 'ZONE', scopeRefId: 'z1' },
    ]);
  });
});
