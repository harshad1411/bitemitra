// The partner's money position (SETTLEMENTS.md §3.2, D-90, D-91): earnings not yet paid, cash in hand, what
// they owe Jamzo or Jamzo owes them, payouts, and reporting a cash deposit (UPI or bank).
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { newIdempotencyKey, useJamzo, userMessage } from '@jamzo/mobile-foundation';
import { Badge, Banner, Button, Card, ErrorState, LoadingState, Text, TextField } from '@jamzo/mobile-ui';
import { parseRupeesToPaise } from '@jamzo/ui';
import { money, time } from '../lib/format';

const METHOD = { UPI: 'UPI', BANK_DEPOSIT: 'Bank deposit', CASH_AT_HUB: 'Cash at hub' };
const STATUS = {
  PENDING: ['Being checked', 'warning'],
  VERIFIED: ['Received', 'success'],
  REJECTED: ['Not accepted', 'critical'],
};

export function Wallet() {
  const { api } = useJamzo();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['wallet'], queryFn: () => api.get('/v1/rider/wallet') });
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('UPI');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const key = useRef(null);
  if (q.isPending) return <LoadingState label="Loading your money" />;
  if (q.isError) return <ErrorState message={userMessage(q.error)} onRetry={() => q.refetch()} />;
  const w = q.data;
  const report = async () => {
    setBusy(true);
    setError(null);
    key.current ??= newIdempotencyKey(); // a retried tap reports the same deposit once
    try {
      await api.post('/v1/rider/cod-deposits', {
        amountPaise: parseRupeesToPaise(amount),
        method,
        reference: reference.trim() || null,
        idempotencyKey: key.current,
      });
      key.current = null;
      setOpen(false);
      setAmount('');
      setReference('');
      await qc.invalidateQueries({ queryKey: ['wallet'] });
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card>
        <Text variant="heading">Your money</Text>
        <Text>{`Earnings not yet paid: ${money(w.earningsBalancePaise)}`}</Text>
        <Text>{`Cash in hand: ${money(w.codHeldPaise)}`}</Text>
        {w.owesPaise ? (
          <Banner tone="warning">{`You owe Jamzo ${money(w.owesPaise)}. Deposit the cash to keep taking cash orders.`}</Banner>
        ) : (
          <Text variant="small">{`Jamzo owes you ${money(w.owedPaise)}${w.netting ? ' after your cash in hand is taken off' : ''}.`}</Text>
        )}
        {w.codHeldPaise > 0 && !open ? (
          <Button title="I deposited cash" variant="secondary" onPress={() => setOpen(true)} />
        ) : null}
      </Card>
      {open ? (
        <Card>
          <Text variant="heading">Report a cash deposit</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {['UPI', 'BANK_DEPOSIT'].map((m) => (
              <Button
                key={m}
                title={METHOD[m]}
                variant={method === m ? 'primary' : 'secondary'}
                onPress={() => setMethod(m)}
              />
            ))}
          </View>
          <TextField label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <TextField
            label="UPI / bank reference"
            value={reference}
            onChangeText={setReference}
            maxLength={100}
          />
          <Text variant="small">
            Jamzo checks the money arrived before it is taken off your cash in hand. Cash at a hub is recorded
            by the hub.
          </Text>
          {error ? <Banner tone="critical">{error}</Banner> : null}
          <Button
            title="Send"
            busy={busy}
            disabled={busy || !(parseRupeesToPaise(amount) >= 100) || reference.trim().length < 3}
            onPress={report}
          />
          <Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} />
        </Card>
      ) : null}
      {w.deposits.length ? (
        <Card>
          <Text variant="heading">Cash deposits</Text>
          {w.deposits.map((d) => {
            const [label, tone] = STATUS[d.status];
            return (
              <View key={d.id} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text>{`${money(d.amountPaise)} · ${METHOD[d.method]}`}</Text>
                  <Badge tone={tone}>{label}</Badge>
                </View>
                {d.note ? <Text variant="small">{d.note}</Text> : null}
              </View>
            );
          })}
        </Card>
      ) : null}
      {w.payouts.length ? (
        <Card>
          <Text variant="heading">Payouts</Text>
          {w.payouts.map((p) => (
            <Text key={p.id}>{`${money(p.amountPaise)} · ${time(p.paidAt)} · ref ${p.reference}`}</Text>
          ))}
        </Card>
      ) : null}
    </>
  );
}
