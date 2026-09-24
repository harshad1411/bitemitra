import { createContext, useContext } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createTheme } from './theme.js';

const ThemeContext = createContext(createTheme());
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = () => useContext(ThemeContext);

/** Safe-area aware screen; scrolls and avoids the keyboard (B8: safe areas, keyboard handling). */
export function Screen({ children, scroll = true, style }) {
  const t = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[{ padding: t.spacing[5], gap: t.spacing[4], flexGrow: 1 }, style]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: t.spacing[5], gap: t.spacing[4] }, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Text({ variant = 'body', style, ...props }) {
  const t = useTheme();
  return <RNText style={[t.text[variant], style]} {...props} />;
}

/** Button with a minimum 44pt touch target, busy state and accessibility role (spec §60). */
export function Button({
  title,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  accessibilityHint,
}) {
  const t = useTheme();
  const primary = variant === 'primary';
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
          minHeight: t.minTouchTarget,
          borderRadius: t.radius.md,
          backgroundColor: primary ? t.colors.primary : t.colors.surface,
          borderColor: primary ? t.colors.primary : t.colors.borderStrong,
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? t.colors.onPrimary : t.colors.primary} /> : null}
      <RNText
        style={{ color: primary ? t.colors.onPrimary : t.colors.text, fontWeight: '600', fontSize: 16 }}
      >
        {title}
      </RNText>
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
            borderRadius: t.radius.md,
            borderColor: error ? t.colors.critical : t.colors.borderStrong,
            backgroundColor: t.colors.surface,
            color: t.colors.text,
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
          borderWidth: 1,
          borderRadius: t.radius.lg,
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
        borderLeftWidth: 4,
        borderLeftColor: fg,
        backgroundColor: t.colors.surfaceMuted,
        padding: t.spacing[3],
        borderRadius: t.radius.sm,
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
