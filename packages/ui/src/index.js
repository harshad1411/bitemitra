// Jamzo design tokens (spec §61). PROVISIONAL palette until brand guidelines exist (DECISIONS D-17, Q-13).
// All colour/typography/spacing used by the admin and mobile apps must come from here.

export const palette = Object.freeze({
  plum: {
    50: '#F6F1FA',
    100: '#EADCF3',
    200: '#D3B7E7',
    300: '#B78AD6',
    400: '#955CC0',
    500: '#763CA4',
    600: '#5B2A86',
    700: '#4A226D',
    800: '#391A54',
    900: '#27123A',
  },
  saffron: {
    50: '#FEF7E6',
    100: '#FDEBC2',
    200: '#FAD78A',
    300: '#F7C152',
    400: '#F4B02B',
    500: '#F2A516',
    600: '#C98410',
    700: '#9C640D',
    800: '#6E460A',
    900: '#432A06',
  },
  teal: {
    50: '#EDFAF8',
    100: '#CCF1EC',
    200: '#99E2D8',
    300: '#5ECBBD',
    400: '#2FAE9F',
    500: '#148F82',
    600: '#0F766E',
    700: '#105E58',
    800: '#114B47',
    900: '#0B302E',
  },
  neutral: {
    0: '#FFFFFF',
    50: '#F7F7F8',
    100: '#EFEFF1',
    200: '#E0E0E4',
    300: '#C8C8CF',
    400: '#9D9DA8',
    500: '#74747F',
    600: '#55555F',
    700: '#3D3D45',
    800: '#26262C',
    900: '#17171B',
  },
  green: { 50: '#EDF9F0', 600: '#1E7A3C', 700: '#17602F' },
  amber: { 50: '#FFF7E8', 600: '#A15C00', 700: '#7F4800' },
  red: { 50: '#FDEEEE', 600: '#C0262D', 700: '#9B1C22' },
  blue: { 50: '#EEF4FD', 600: '#1F5FBF', 700: '#194C99' },
});

/** Semantic colours (light theme). Pairs meet WCAG AA contrast for text on their background. */
export const colors = Object.freeze({
  primary: palette.plum[600],
  primaryHover: palette.plum[700],
  onPrimary: palette.neutral[0],
  accent: palette.saffron[500],
  background: palette.neutral[50],
  surface: palette.neutral[0],
  surfaceMuted: palette.neutral[100],
  border: palette.neutral[200],
  borderStrong: palette.neutral[300],
  text: palette.neutral[900],
  textMuted: palette.neutral[600],
  textSubtle: palette.neutral[500],
  focus: palette.plum[500],
  success: palette.green[600],
  warning: palette.amber[600],
  critical: palette.red[600],
  info: palette.blue[600],
});

/** Status badge tones: background + foreground. */
export const statusTones = Object.freeze({
  neutral: { bg: palette.neutral[100], fg: palette.neutral[700] },
  info: { bg: palette.blue[50], fg: palette.blue[700] },
  success: { bg: palette.green[50], fg: palette.green[700] },
  warning: { bg: palette.amber[50], fg: palette.amber[700] },
  critical: { bg: palette.red[50], fg: palette.red[700] },
  accent: { bg: palette.plum[50], fg: palette.plum[700] },
});

/** Per-app accent (placeholder icon/splash colours come from @jamzo/config apps registry). */
export const appAccents = Object.freeze({
  CUSTOMER: palette.plum[600],
  RESTAURANT: palette.teal[600],
  RIDER: palette.saffron[500],
  ADMIN: palette.plum[600],
});

export const typography = Object.freeze({
  fontFamily: {
    sans: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  size: { xs: 12, sm: 13, md: 14, lg: 16, xl: 18, '2xl': 22, '3xl': 28 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeight: { tight: 1.25, normal: 1.45, relaxed: 1.6 },
});

/** 4-point spacing scale. */
export const spacing = Object.freeze({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 });
export const radius = Object.freeze({ sm: 6, md: 8, lg: 12, xl: 16, full: 9999 });
export const elevation = Object.freeze({
  none: 'none',
  sm: '0 1px 2px rgba(23,23,27,0.06)',
  md: '0 2px 6px rgba(23,23,27,0.08), 0 1px 2px rgba(23,23,27,0.06)',
  lg: '0 8px 24px rgba(23,23,27,0.12)',
});
export const iconSize = Object.freeze({ sm: 16, md: 20, lg: 24 });
/** Minimum touch target (spec §60). */
export const minTouchTarget = 44;

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/**
 * Display helper only — never used to compute money. 12345 → "₹123.45".
 * @param {number} paise integer
 */
export function formatPaise(paise) {
  if (!Number.isSafeInteger(paise)) throw new TypeError('formatPaise expects integer paise');
  return inr.format(paise / 100);
}
