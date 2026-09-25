// Payouts (SETTLEMENTS.md §2.5, D-89): what Jamzo owes the restaurant, what is waiting for the next
// settlement and past settlements — from the restaurant's own prices only (never Jamzo's margins).
// Owners and managers only.
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { formatPaise } from '@jamzo/ui';
import { useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Badge, Card, EmptyState, ErrorState, LoadingState, Screen, Text } from '@jamzo/mobile-ui';
import { useResource } from '../lib/use-resource';

const SCHEDULE = {
  DAILY: 'every day',
  T_PLUS_1: 'the day after delivery',
  T_PLUS_2: 'two days after delivery',
  WEEKLY: 'every week',
  MANUAL: 'when Jamzo runs it',
};
const STATUS = {
  DRAFT: ['Being checked', 'warning'],
  PENDING: ['Being checked', 'warning'],
  PROCESSING: ['Being paid', 'info'],
  PAID: ['Paid', 'success'],
  FAILED: ['Payment failed — Jamzo will retry', 'critical'],
};
const day = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

function Row({ label, value, strong }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={strong ? { fontWeight: '700' } : undefined}>{label}</Text>
      <Text style={strong ? { fontWeight: '700' } : undefined}>{value}</Text>
    </View>
  );
}

export default function Payouts() {
  const { restaurantId } = useLocalSearchParams();
  const { api } = useJamzo();
  const q = useResource(() => api.get('/v1/restaurant/payouts', { restaurantId }), [restaurantId]);
  if (q.status === 'loading') return <LoadingState label="Loading payouts" />;
  if (q.status === 'error' && !q.data)
    return (
      <Screen>
        <ErrorState message={userMessage(q.error)} onRetry={q.reload} />
      </Screen>
    );
  const p = q.data;
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        Payouts
      </Text>
      <Card>
        <Text variant="heading">{`Jamzo owes you ${formatPaise(p.balancePaise)}`}</Text>
        <Text variant="small">
          {`Settled ${SCHEDULE[p.schedule] ?? p.schedule}${p.nextSettlementDate ? ` · next on ${day(p.nextSettlementDate)}` : ''}. Amounts under ${formatPaise(p.minPayoutPaise)} wait for the next settlement.`}
        </Text>
      </Card>
      <Card>
        <Text variant="heading">{`Waiting for the next settlement (${p.pending.orders} orders)`}</Text>
        <Row label="Food sales (your prices)" value={formatPaise(p.pending.foodSalesPaise)} />
        <Row label="Commission" value={`− ${formatPaise(p.pending.commissionPaise)}`} />
        <Row label="Tax on commission" value={`− ${formatPaise(p.pending.commissionTaxPaise)}`} />
        <Row label="Your discounts" value={`− ${formatPaise(p.pending.discountsPaise)}`} />
        {p.pending.refundsPaise ? (
          <Row label="Refunds" value={`− ${formatPaise(p.pending.refundsPaise)}`} />
        ) : null}
        {p.pending.adjustmentsPaise ? (
          <Row label="Adjustments and compensation" value={formatPaise(p.pending.adjustmentsPaise)} />
        ) : null}
        <Row label="Net" value={formatPaise(p.pending.netPaise)} strong />
      </Card>
      <Text variant="heading">Settlements</Text>
      {p.settlements.length ? (
        p.settlements.map((s) => {
          const [label, tone] = STATUS[s.status] ?? [s.status, 'neutral'];
          return (
            <Card key={s.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text variant="heading">{`${day(s.periodStart)} – ${day(new Date(new Date(s.periodEnd).getTime() - 1))}`}</Text>
                <Badge tone={tone}>{label}</Badge>
              </View>
              <Row label="Food sales" value={formatPaise(s.grossSalesPaise)} />
              <Row label="Commission and tax" value={`− ${formatPaise(s.commissionPaise + s.taxesPaise)}`} />
              <Row label="Your discounts" value={`− ${formatPaise(s.discountsPaise)}`} />
              {s.refundsPaise ? <Row label="Refunds" value={`− ${formatPaise(s.refundsPaise)}`} /> : null}
              {s.adjustmentsPaise ? (
                <Row label="Adjustments" value={formatPaise(s.adjustmentsPaise)} />
              ) : null}
              <Row label="Paid to you" value={formatPaise(s.netPayablePaise)} strong />
              {s.payoutReference ? <Text variant="small">{`Reference ${s.payoutReference}`}</Text> : null}
            </Card>
          );
        })
      ) : (
        <EmptyState
          title="No settlements yet"
          message="Your first settlement appears after your first delivered orders."
        />
      )}
      <Text variant="small">
        Commission and tax amounts are provisional until Jamzo's tax review is complete.
      </Text>
    </Screen>
  );
}
