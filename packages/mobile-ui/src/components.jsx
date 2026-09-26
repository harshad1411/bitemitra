import { createContext, useContext } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { statusTones } from '@jamzo/ui';
import { createTheme } from './theme.js';

const ThemeContext = createContext(createTheme());
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = () => useContext(ThemeContext);

/**
 * Navigation the shared components need without depending on a router: `back()` for the header arrow.
 * Apps provide it once at the root (D-108).
 */
const NavContext = createContext({ back: () => {} });
export const NavProvider = NavContext.Provider;
export const useNav = () => useContext(NavContext);

/**
 * Safe-area aware screen; scrolls and avoids the keyboard (B8). `header` stays at the top and `footer`
 * (a cart bar, a pay button) stays at the bottom while the content scrolls.
 */
export function Screen({ children, scroll = true, style, header, footer, padded = true, edges }) {
  const t = useTheme();
  const pad = padded ? { padding: t.spacing[4], gap: t.spacing[4] } : null;
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[pad, { flexGrow: 1, paddingBottom: t.spacing[8] }, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, pad, style]}>{children}</View>
  );
  return (
    <SafeAreaView
      edges={edges ?? (header ? ['top', 'left', 'right'] : undefined)}
      style={{ flex: 1, backgroundColor: t.colors.background }}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header}
        {body}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const WEIGHTED = {
  display: { 500: 'displayMedium', 600: 'display', 700: 'displayBold', bold: 'displayBold' },
  text: { 500: 'medium', 600: 'semibold', 700: 'semibold', bold: 'semibold' },
};

/**
 * Themed text. Custom fonts come as one family per weight, so a `fontWeight` in `style` is turned into the
 * matching family (Android ignores fontWeight on custom fonts).
 */
export function Text({ variant = 'body', style, ...props }) {
  const t = useTheme();
  const base = t.text[variant] ?? t.text.body;
  const flat = StyleSheet.flatten(style) ?? {};
  let resolved = [base, style];
  if (flat.fontWeight && !flat.fontFamily) {
    const display = base.fontFamily?.startsWith('Poppins');
    const key = WEIGHTED[display ? 'display' : 'text'][String(flat.fontWeight)];
    const { fontWeight: _w, ...rest } = flat;
    resolved = [base, rest, key ? { fontFamily: t.fonts[key] } : null];
  }
  return <RNText style={resolved} {...props} />;
}

/** Ionicons (bundled with Expo). `name` is an Ionicons name, e.g. "arrow-back". */
export function Icon({ name, size = 20, color, style }) {
  const t = useTheme();
  return <Ionicons name={name} size={size} color={color ?? t.colors.text} style={style} />;
}

/** Round icon button (header actions), 44pt touch target. */
export function IconButton({ icon, label, onPress, color, background }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background ?? t.colors.surface,
        borderWidth: background ? 0 : StyleSheet.hairlineWidth,
        borderColor: t.colors.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={20} color={color} />
    </Pressable>
  );
}

/**
 * Top bar for every screen that is not a tab (D-108): a back arrow, a title (and optional subtitle), and
 * optional actions on the right. `onBack` overrides the app's default back.
 */
export function Header({ title, subtitle, right, onBack, back = true, children }) {
  const t = useTheme();
  const nav = useNav();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing[3],
        paddingHorizontal: t.spacing[4],
        paddingVertical: t.spacing[2],
        minHeight: 56,
        backgroundColor: t.colors.background,
      }}
    >
      {back ? <IconButton icon="arrow-back" label="Back" onPress={onBack ?? nav.back} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {children ?? (
          <>
            {title ? (
              <Text variant="subheading" numberOfLines={1} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {subtitle ? (
              <Text variant="small" numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </>
        )}
      </View>
      {right}
    </View>
  );
}

/**
 * Button with a minimum 44pt touch target, busy state and accessibility role (spec §60).
 * Variants: primary (leaf green — main actions), dark (navy), secondary (outlined), ghost (text only).
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  accessibilityHint,
  icon,
  size = 'md',
}) {
  const t = useTheme();
  const look = {
    primary: { bg: t.colors.action, fg: t.colors.onAction, border: t.colors.action },
    dark: { bg: t.colors.primary, fg: t.colors.onPrimary, border: t.colors.primary },
    secondary: { bg: t.colors.surface, fg: t.colors.text, border: t.colors.borderStrong },
    ghost: { bg: 'transparent', fg: t.colors.action, border: 'transparent' },
  }[variant] ?? { bg: t.colors.action, fg: t.colors.onAction, border: t.colors.action };
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: size === 'lg' ? 52 : t.minTouchTarget,
          borderRadius: t.radius.lg,
          backgroundColor: look.bg,
          borderColor: look.border,
          opacity: off ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={look.fg} />
      ) : icon ? (
        <Icon name={icon} size={18} color={look.fg} />
      ) : null}
      <RNText style={{ color: look.fg, fontFamily: t.fonts.display, fontSize: size === 'lg' ? 17 : 15 }}>
        {title}
      </RNText>
    </Pressable>
  );
}

/** Food-app "ADD" button; becomes a − n + stepper once the item is in the cart (D-109). */
export function AddButton({ quantity = 0, onAdd, onChange, label, customisable = false, width = 104 }) {
  const t = useTheme();
  const box = {
    width,
    height: 38,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.action,
    backgroundColor: quantity ? t.colors.action : t.colors.actionSoft,
    alignItems: 'center',
    justifyContent: 'center',
  };
  if (!quantity)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${label}`}
        accessibilityHint={customisable ? 'Choose size and options' : undefined}
        onPress={onAdd}
        style={({ pressed }) => [box, { opacity: pressed ? 0.8 : 1 }]}
      >
        <RNText style={{ color: t.colors.action, fontFamily: t.fonts.displayBold, fontSize: 16 }}>ADD</RNText>
        <RNText
          style={{ position: 'absolute', top: 1, right: 7, color: t.colors.action, fontSize: 13 }}
          importantForAccessibility="no"
        >
          +
        </RNText>
      </Pressable>
    );
  return <Stepper value={quantity} onChange={onChange} label={label} filled width={width} />;
}

/** − n + quantity control. `filled` = white on green (menu), otherwise green outline (cart). */
export function Stepper({ value, onChange, label, filled = false, width = 96, min = 0, max = 50 }) {
  const t = useTheme();
  const fg = filled ? t.colors.onAction : t.colors.action;
  const btn = (sign, next, hint) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      disabled={next < min || next > max}
      onPress={() => onChange(next)}
      hitSlop={4}
      style={{ flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }}
    >
      <RNText style={{ color: fg, fontFamily: t.fonts.displayBold, fontSize: 18 }}>{sign}</RNText>
    </Pressable>
  );
  return (
    <View
      style={{
        width,
        height: 38,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: t.colors.action,
        backgroundColor: filled ? t.colors.action : t.colors.actionSoft,
      }}
    >
      {btn('−', value - 1, `One less ${label}`)}
      <RNText
        accessibilityLabel={`${label} quantity ${value}`}
        style={{ color: fg, fontFamily: t.fonts.display, fontSize: 15, minWidth: 18, textAlign: 'center' }}
      >
        {value}
      </RNText>
      {btn('+', value + 1, `One more ${label}`)}
    </View>
  );
}

/** A tappable row with an icon, a label, an optional value and a chevron (account, settings). */
export function ListRow({ icon, label, value, onPress, danger = false, last = false }) {
  const t = useTheme();
  const color = danger ? t.colors.critical : t.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing[3],
        minHeight: 52,
        backgroundColor: pressed ? t.colors.surfaceMuted : 'transparent',
      })}
    >
      {icon ? <Icon name={icon} size={20} color={danger ? color : t.colors.textMuted} /> : null}
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'stretch',
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: t.colors.border,
        }}
      >
        <Text style={{ flex: 1, color }}>{label}</Text>
        {value ? <Text variant="muted">{value}</Text> : null}
        <Icon name="chevron-forward" size={18} color={t.colors.textSubtle} style={{ marginLeft: 6 }} />
      </View>
    </Pressable>
  );
}

/** Section heading inside a card, with the brand's small accent bar. */
export function SectionTitle({ children, right }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] }}>
      <View
        style={{ width: 3, height: 20, borderRadius: 2, backgroundColor: t.colors.accent, marginLeft: -16 }}
      />
      <Text variant="heading" style={{ flex: 1, marginLeft: 13 }} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

/** Filter chip (Veg, Bestseller …). */
export function Chip({ label, selected = false, onPress, icon }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: selected ? t.colors.primary : t.colors.borderStrong,
        backgroundColor: selected ? t.colors.surfaceMuted : t.colors.surface,
      }}
    >
      {icon}
      <Text variant="muted" style={{ color: t.colors.text, fontWeight: '500' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function TextField({ label, error, help, ...inputProps }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing[1] }}>
      <Text variant="muted" style={{ color: t.colors.text, fontWeight: '500' }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.colors.textSubtle}
        style={[
          styles.input,
          {
            minHeight: t.minTouchTarget,
            borderRadius: t.radius.lg,
            borderColor: error ? t.colors.critical : t.colors.borderStrong,
            backgroundColor: t.colors.surface,
            color: t.colors.text,
            fontFamily: t.fonts.regular,
          },
        ]}
        {...inputProps}
      />
      {help && !error ? <Text variant="small">{help}</Text> : null}
      {error ? (
        <Text variant="small" style={{ color: t.colors.critical }} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Card({ children, style }) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: t.radius.xl,
          padding: t.spacing[4],
          gap: t.spacing[2],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Banner({ tone = 'info', children, action }) {
  const t = useTheme();
  const fg = {
    info: t.colors.info,
    warning: t.colors.warning,
    critical: t.colors.critical,
    success: t.colors.success,
  }[tone];
  return (
    <View
      accessibilityRole="alert"
      style={{
        borderWidth: 1,
        borderColor: `${fg}40`,
        backgroundColor: `${fg}12`,
        padding: t.spacing[3],
        borderRadius: t.radius.lg,
        gap: t.spacing[2],
      }}
    >
      <Text variant="muted" style={{ color: t.colors.text }}>
        {children}
      </Text>
      {action}
    </View>
  );
}

export function LoadingState({ label = 'Loading' }) {
  const t = useTheme();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={t.colors.primary} />
      <Text variant="muted">{label}…</Text>
    </View>
  );
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Text variant="heading">{title}</Text>
      {message ? (
        <Text variant="muted" style={{ textAlign: 'center' }}>
          {message}
        </Text>
      ) : null}
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function EmptyState({ title, message, action }) {
  return (
    <View style={styles.center}>
      <Text variant="heading">{title}</Text>
      {message ? (
        <Text variant="muted" style={{ textAlign: 'center' }}>
          {message}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  input: { borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});

/** Label + description + native switch; the whole row is one accessible switch (44pt minimum). */
export function ToggleRow({ label, description, value, onValueChange, disabled = false }) {
  const t = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing[3], minHeight: t.minTouchTarget }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="body">{label}</Text>
        {description ? <Text variant="small">{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: t.colors.action, false: t.colors.borderStrong }}
      />
    </View>
  );
}

/** Small status pill using the shared status tones (neutral | info | success | warning | critical | accent). */
export function Badge({ tone = 'neutral', children }) {
  const t = useTheme();
  const c = statusTones[tone] ?? statusTones.neutral;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: c.bg,
        borderRadius: t.radius.full ?? 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <RNText style={{ color: c.fg, fontSize: 12, fontFamily: t.fonts.semibold }}>{children}</RNText>
    </View>
  );
}
