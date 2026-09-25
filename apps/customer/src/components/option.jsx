// A single or multiple choice row (radio / checkbox) with a large touch target.
import { Pressable, View } from 'react-native';
import { Text, useTheme } from '@jamzo/mobile-ui';

export function Option({ label, detail, selected, onPress, disabled, multi }) {
  const t = useTheme();
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
        minHeight: t.minTouchTarget,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: multi ? 4 : 10,
          borderWidth: 2,
          borderColor: t.colors.primary,
          backgroundColor: selected ? t.colors.primary : 'transparent',
        }}
      />
      <Text style={{ flex: 1 }}>{label}</Text>
      {detail ? <Text variant="small">{detail}</Text> : null}
    </Pressable>
  );
}
