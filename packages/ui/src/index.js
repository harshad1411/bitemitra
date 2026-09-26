// Jamzo design tokens (spec §61). Brand colours and fonts from the Jamzo logo kit (DECISIONS D-107).
// All colour/typography/spacing used by the admin and mobile apps must come from here.

export const palette = Object.freeze({
  // Jamzo logo kit v7: midnight navy #1B2250, turmeric #F2B21B, leaf green #2F8F6B, cool white #F4F5FB.
  navy: {
    50: '#EEF0F8',
    100: '#DADEF0',
    200: '#B3BADD',
    300: '#8791C4',
    400: '#5A64A0',
    500: '#38417A',
    600: '#1B2250',
    700: '#151A40',
    800: '#0F1330',
    900: '#0A0D20',
  },
  turmeric: { 50: '#FEF6E1', 100: '#FDEAB8', 300: '#F7C94E', 500: '#F2B21B', 700: '#A87808', 800: '#7A5600' },
  // Leaf 600 is the kit colour (icons, veg marks). White text needs leaf 700 for WCAG AA (D-107).
  leaf: { 50: '#E8F5EF', 100: '#C9E8D9', 600: '#2F8F6B', 700: '#267A5B', 800: '#1D5E46' },
  coolWhite: '#F4F5FB',
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
  primary: palette.navy[600],
  primaryHover: palette.navy[700],
  onPrimary: palette.neutral[0],
  accent: palette.turmeric[500],
  onAccent: palette.navy[600],
  /** Main actions (Add, View cart, Place order): leaf green, like the food apps customers know. */
  action: palette.leaf[700],
  actionSoft: palette.leaf[50],
  onAction: palette.neutral[0],
  background: palette.coolWhite,
  surface: palette.neutral[0],
  surfaceMuted: palette.navy[50],
  border: '#E3E5EF',
  borderStrong: '#C9CCDD',
  text: palette.navy[600],
  textMuted: '#5A6080',
  textSubtle: '#7C8199',
  focus: palette.navy[400],
  success: palette.leaf[700],
  veg: palette.leaf[600],
  warning: palette.amber[600],
  critical: palette.red[600],
  info: palette.blue[600],
  offer: palette.blue[600],
});

/** Status badge tones: background + foreground. */
export const statusTones = Object.freeze({
  neutral: { bg: palette.neutral[100], fg: palette.neutral[700] },
  info: { bg: palette.blue[50], fg: palette.blue[700] },
  success: { bg: palette.green[50], fg: palette.green[700] },
  warning: { bg: palette.amber[50], fg: palette.amber[700] },
  critical: { bg: palette.red[50], fg: palette.red[700] },
  accent: { bg: palette.turmeric[50], fg: palette.turmeric[800] },
});

/** Per-app accent: all apps share the Jamzo navy (D-107). */
export const appAccents = Object.freeze({
  CUSTOMER: palette.navy[600],
  RESTAURANT: palette.navy[600],
  RIDER: palette.navy[600],
  ADMIN: palette.navy[600],
});

export const typography = Object.freeze({
  // Poppins for titles, prices and buttons; Inter for reading text (D-107). Both SIL Open Font License.
  fontFamily: {
    display: 'Poppins, Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    sans: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  /** Font names as loaded in the mobile apps (@expo-google-fonts), one family per weight. */
  native: {
    display: 'Poppins_600SemiBold',
    displayBold: 'Poppins_700Bold',
    displayMedium: 'Poppins_500Medium',
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
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

const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/**
 * Customer-facing price, as food apps show it (D-107): whole rupees without ".00", paise only when there are
 * some. 18000 → "₹180", 18050 → "₹180.50". Display only — never used to compute money.
 * @param {number} paise integer
 */
export function formatPrice(paise) {
  if (!Number.isSafeInteger(paise)) throw new TypeError('formatPrice expects integer paise');
  return paise % 100 === 0 ? inrWhole.format(paise / 100) : inr.format(paise / 100);
}

/**
 * Display helper only — never used to compute money. 12345 → "₹123.45".
 * @param {number} paise integer
 */
export function formatPaise(paise) {
  if (!Number.isSafeInteger(paise)) throw new TypeError('formatPaise expects integer paise');
  return inr.format(paise / 100);
}

/**
 * Parses a rupee amount typed by a person ("180", "180.5", "1,80.50", "₹ 99") into integer paise without
 * floating-point arithmetic. Returns null when the text is not a valid amount (max two decimals).
 * @param {string} text
 * @returns {number | null}
 */
export function parseRupeesToPaise(text) {
  const clean = String(text ?? '')
    .replace(/[₹,\s]/g, '')
    .trim();
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(clean);
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

/**
 * Integer paise → plain rupee text for an input field ("18050" → "180.50", "18000" → "180").
 * @param {number | null | undefined} paise
 */
export function paiseToRupeeInput(paise) {
  if (paise == null) return '';
  if (!Number.isSafeInteger(paise) || paise < 0)
    throw new TypeError('paiseToRupeeInput expects non-negative integer paise');
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest ? `${rupees}.${String(rest).padStart(2, '0')}` : String(rupees);
}
