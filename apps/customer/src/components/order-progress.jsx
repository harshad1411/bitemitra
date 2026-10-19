// Order tracking at a glance (D-119): a coloured status card and four steps — placed, being prepared, on the
// way, delivered — each with the time it happened. Cancelled and unpaid orders show only the status card.
import { View } from 'react-native';
import { Icon, Text, useTheme } from '@jamzo/mobile-ui';

const STAGE = {
  PLACED: 0,
  RESTAURANT_NOTIFIED: 0,
  RESTAURANT_ACCEPTED: 1,
  PREPARING: 1,
  READY_FOR_PICKUP: 1,
  RIDER_SEARCHING: 1,
  RIDER_ASSIGNED: 1,
  RIDER_ACCEPTED: 1,
  RIDER_AT_RESTAURANT: 1,
  PICKED_UP: 2,
  ON_THE_WAY: 2,
  ARRIVED: 2,
  DELIVERED: 3,
};
const STEPS = [
  { label: 'Order placed', at: ['PLACED'] },
  { label: 'Being prepared', at: ['RESTAURANT_ACCEPTED'] },
  { label: 'On the way', at: ['PICKED_UP'] },
  { label: 'Delivered', at: ['DELIVERED'] },
];
const ENDED = [
  'CUSTOMER_CANCELLED',
  'RESTAURANT_CANCELLED',
  'RESTAURANT_REJECTED',
  'ADMIN_CANCELLED',
  'RIDER_ISSUE',
  'PAYMENT_FAILED',
];

const clock = (d) =>
  new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** The coloured card on top: what is happening now, in words. */
export function StatusCard({ order, status, eta }) {
  const t = useTheme();
  const ended = ENDED.includes(order.status);
  const done = order.status === 'DELIVERED';
  const bg = ended ? t.colors.surfaceMuted : done ? t.colors.action : t.colors.primary;
  const fg = ended ? t.colors.text : t.colors.onPrimary;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 20, padding: t.spacing[4], gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon
          name={ended ? 'close-circle' : done ? 'checkmark-circle' : 'time'}
          size={22}
          color={ended ? t.colors.critical : done ? t.colors.onPrimary : t.colors.accent}
        />
        <Text variant="title" accessibilityRole="header" style={{ color: fg, flex: 1 }}>
          {status.title}
        </Text>
      </View>
      {status.text ? <Text style={{ color: fg, opacity: 0.9 }}>{status.text}</Text> : null}
      {eta ? <Text style={{ color: t.colors.accent, fontFamily: t.fonts.semibold }}>{eta}</Text> : null}
    </View>
  );
}

/** Four steps with ticks and times; nothing for cancelled or unpaid orders. */
export function ProgressSteps({ order }) {
  const t = useTheme();
  const stage = STAGE[order.status];
  if (stage === undefined) return null;
  const timeOf = (statuses) => order.timeline.find((x) => statuses.includes(x.status))?.at ?? null;
  return (
    <View
      accessibilityLabel={`Progress: ${STEPS[stage].label}`}
      style={{
        backgroundColor: t.colors.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: t.colors.border,
        padding: t.spacing[4],
      }}
    >
      {STEPS.map((s, i) => {
        const reached = i <= stage;
        const current = i === stage && stage < 3;
        const at = reached ? timeOf(s.at) : null;
        return (
          <View key={s.label} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center', width: 24 }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: reached ? t.colors.action : t.colors.surfaceMuted,
                  borderWidth: current ? 3 : 0,
                  borderColor: t.colors.accent,
                }}
              >
                {reached && !current ? <Icon name="checkmark" size={14} color={t.colors.onAction} /> : null}
              </View>
              {i < STEPS.length - 1 ? (
                <View
                  style={{
                    width: 2,
                    flex: 1,
                    minHeight: 18,
                    backgroundColor: i < stage ? t.colors.action : t.colors.border,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: i < STEPS.length - 1 ? 14 : 0 }}>
              <Text
                style={{
                  fontFamily: current ? t.fonts.semibold : t.fonts.regular,
                  color: reached ? t.colors.text : t.colors.textSubtle,
                }}
              >
                {s.label}
              </Text>
              {at ? <Text variant="small">{clock(at)}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
