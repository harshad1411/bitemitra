import { describe, expect, it } from 'vitest';
import { colors, formatPaise, statusTones } from './index.js';

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
});
