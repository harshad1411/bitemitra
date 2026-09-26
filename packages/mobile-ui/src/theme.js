// React Native theme derived from @jamzo/ui tokens (spec §61, D-107). Apps pass their accent colour.
import { colors, minTouchTarget, radius, spacing, typography } from '@jamzo/ui';

const f = typography.native;

export function createTheme(accent = colors.primary) {
  return {
    colors: { ...colors, primary: accent },
    spacing,
    radius,
    minTouchTarget,
    fonts: f,
    text: {
      title: { fontFamily: f.display, fontSize: 22, lineHeight: 30, color: colors.text },
      heading: { fontFamily: f.display, fontSize: 18, lineHeight: 26, color: colors.text },
      subheading: { fontFamily: f.displayMedium, fontSize: 16, lineHeight: 22, color: colors.text },
      body: { fontFamily: f.regular, fontSize: 16, lineHeight: 22, color: colors.text },
      strong: { fontFamily: f.semibold, fontSize: 16, lineHeight: 22, color: colors.text },
      price: { fontFamily: f.displayMedium, fontSize: 15, lineHeight: 21, color: colors.text },
      muted: { fontFamily: f.regular, fontSize: 14, lineHeight: 20, color: colors.textMuted },
      small: { fontFamily: f.regular, fontSize: 13, lineHeight: 18, color: colors.textMuted },
      label: {
        fontFamily: f.medium,
        fontSize: 11,
        letterSpacing: 1,
        textTransform: 'uppercase',
        color: colors.textSubtle,
      },
    },
  };
}
