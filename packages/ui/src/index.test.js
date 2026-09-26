import { describe, expect, it } from 'vitest';
import {
  colors,
  formatPaise,
  formatPrice,
  paiseToRupeeInput,
  parseRupeesToPaise,
  statusTones,
} from './index.js';

/** WCAG relative luminance contrast. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, b2] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('tokens', () => {
  it('text and status badge pairs meet WCAG AA (4.5:1)', () => {
    expect(contrast(colors.text, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textMuted, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onPrimary, colors.primary)).toBeGreaterThanOrEqual(4.5);
    for (const [name, t] of Object.entries(statusTones)) {
      expect(contrast(t.fg, t.bg), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('formats paise for display only', () => {
    expect(formatPaise(47_900)).toBe('₹479.00');
    expect(formatPaise(12_345_678)).toBe('₹1,23,456.78');
    expect(() => formatPaise(1.5)).toThrow();
  });

  it('customer prices drop ".00" but keep real paise (D-107)', () => {
    expect(formatPrice(18_000)).toBe('₹180');
    expect(formatPrice(18_050)).toBe('₹180.50');
    expect(formatPrice(18_005)).toBe('₹180.05');
    expect(formatPrice(12_345_600)).toBe('₹1,23,456');
    expect(formatPrice(0)).toBe('₹0');
    expect(() => formatPrice(1.5)).toThrow();
  });

  it('brand action colours meet WCAG AA with white text', () => {
    expect(contrast(colors.onAction, colors.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textMuted, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('rupee input ↔ paise (no floating point)', () => {
  it.each([
    ['180', 18000],
    ['180.5', 18050],
    ['180.50', 18050],
    ['0.1', 10],
    ['0.07', 7],
    ['₹ 1,23,456.78', 12345678],
    ['12.', 1200],
    ['', null],
    ['12.345', null],
    ['-5', null],
    ['abc', null],
  ])('%s → %s', (text, paise) => {
    expect(parseRupeesToPaise(text)).toBe(paise);
  });

  it('formats back for inputs', () => {
    expect(paiseToRupeeInput(18050)).toBe('180.50');
    expect(paiseToRupeeInput(18000)).toBe('180');
    expect(paiseToRupeeInput(7)).toBe('0.07');
    expect(paiseToRupeeInput(null)).toBe('');
    // 0.1 + 0.2 style float errors cannot happen: every value round-trips exactly.
    for (let p = 0; p < 5000; p += 7) expect(parseRupeesToPaise(paiseToRupeeInput(p))).toBe(p);
  });
});
