// A single or multiple choice row (radio / checkbox) with a large touch target; label left, price and the
// control on the right, as in food apps (D-109).
import { Pressable, View } from 'react-native';
import { Icon, Text, useTheme } from '@jamzo/mobile-ui';

export function Option({ label, detail, selected, onPress, disabled, multi, leading }) {
  const t = useTheme();
  const color = selected ? t.colors.action : t.colors.borderStrong;
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing[2],
        minHeight: 48,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {leading}
      <Text style={{ flex: 1 }}>{label}</Text>
      {detail ? <Text variant="muted">{detail}</Text> : null}
      {multi ? (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: color,
            backgroundColor: selected ? t.colors.action : 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? <Icon name="checkmark" size={15} color={t.colors.onAction} /> : null}
        </View>
      ) : (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {selected ? (
            <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: t.colors.action }} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
