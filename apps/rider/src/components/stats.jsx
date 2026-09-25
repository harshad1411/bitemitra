// The partner's own numbers (spec §46, D-96): trips, distance, earnings, tips, incentives, cash collected,
// online hours and acceptance.
import { useQuery } from '@tanstack/react-query';
import { useJamzo } from '@jamzo/mobile-foundation';
import { Card, Text } from '@jamzo/mobile-ui';
import { money } from '../lib/format';

export function Stats({ range }) {
  const { api } = useJamzo();
  const q = useQuery({
    queryKey: ['rider-stats', range],
    queryFn: () => api.get('/v1/rider/analytics', { range: range === 'WEEK' ? 'WEEK' : 'TODAY' }),
  });
  if (!q.data) return null;
  const s = q.data;
  const hours = `${Math.floor(s.onlineMinutes / 60)} h ${s.onlineMinutes % 60} min`;
  return (
    <Card>
      <Text variant="heading">{range === 'WEEK' ? 'This week' : 'Today'}</Text>
      <Text>{`${s.trips} trips · ${(s.distanceM / 1000).toFixed(1)} km · online ${hours}`}</Text>
      <Text>{`Earned ${money(s.earningsPaise)} (tips ${money(s.tipsPaise)}, incentives ${money(s.incentivesPaise)})`}</Text>
      <Text variant="small">{`Cash collected ${money(s.cashCollectedPaise)}${s.acceptanceRate == null ? '' : ` · accepted ${Math.round(s.acceptanceRate * 100)}% of requests`}`}</Text>
    </Card>
  );
}
