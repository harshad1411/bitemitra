// React Native theme derived from @jamzo/ui tokens (spec §61). Apps pass their accent colour.
import { colors, minTouchTarget, radius, spacing, typography } from '@jamzo/ui';

export function createTheme(accent = colors.primary) {
  return {
    colors: { ...colors, primary: accent },
    spacing,
    radius,
    minTouchTarget,
    text: {
      title: { fontSize: typography.size['2xl'], fontWeight: '700', color: colors.text },
      heading: { fontSize: typography.size.xl, fontWeight: '600', color: colors.text },
      body: { fontSize: typography.size.lg, color: colors.text, lineHeight: 22 },
      muted: { fontSize: typography.size.md, color: colors.textMuted, lineHeight: 20 },
      small: { fontSize: typography.size.sm, color: colors.textMuted },
    },
  };
}
