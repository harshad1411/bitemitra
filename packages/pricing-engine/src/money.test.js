import { describe, expect, it } from 'vitest';
import { allocate, applyBps, divRoundHalfUp, inclusiveTax, roundToStep } from './money.js';

describe('money', () => {
  it('applyBps rounds half-up on integers (PRICING.md worked example values)', () => {
    expect(applyBps(20_000, 1000)).toBe(2000); // 10% markup on ₹200
    expect(applyBps(37_800, 1200)).toBe(4536); // 12% commission
    expect(applyBps(4536, 1800)).toBe(816); // 816.48 → 816
    expect(applyBps(47_900, 200)).toBe(958);
    expect(applyBps(5, 1000)).toBe(1); // 0.5 → 1 (half-up)
    expect(applyBps(4, 1000)).toBe(0); // 0.4 → 0
    expect(applyBps(0, 1234)).toBe(0);
  });

  it('refuses floats and negative rates', () => {
    expect(() => applyBps(100.5, 100)).toThrow(TypeError);
    expect(() => applyBps(100, 12.5)).toThrow(TypeError);
    expect(() => applyBps(100, -1)).toThrow(TypeError);
  });

  it('divRoundHalfUp is symmetric for negatives', () => {
    expect(divRoundHalfUp(15, 10)).toBe(2);
    expect(divRoundHalfUp(-15, 10)).toBe(-2);
    expect(divRoundHalfUp(14, 10)).toBe(1);
  });

  it('extracts inclusive tax', () => {
    expect(inclusiveTax(10_500, 500)).toBe(500); // ₹105 incl. 5% GST → ₹5
    expect(inclusiveTax(11_800, 1800)).toBe(1800);
  });

  it('rounds to steps in every direction', () => {
    expect(roundToStep(47_940, 100)).toBe(47_900);
    expect(roundToStep(47_950, 100)).toBe(48_000);
    expect(roundToStep(47_901, 100, 'UP')).toBe(48_000);
    expect(roundToStep(47_999, 100, 'DOWN')).toBe(47_900);
    expect(roundToStep(22_300, 500)).toBe(22_500);
  });

  it('allocate always sums exactly and is deterministic', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(4400, [22_000, 22_000])).toEqual([2200, 2200]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    for (let seed = 1; seed < 500; seed++) {
      const weights = Array.from(
        { length: (seed % 7) + 1 },
        (_, i) => ((seed * (i + 3)) % 997) + (i === 0 ? 1 : 0),
      );
      const total = (seed * 7919) % 100_000;
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => Number.isSafeInteger(p) && p >= 0)).toBe(true);
    }
    expect(() => allocate(10, [0, 0])).toThrow(RangeError);
  });
});
