'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { PaidDialog } from '@/components/payments/paid-dialog';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { ENTRY_TYPE, SETTLEMENT_STATUS, dateOnly, signedPaise } from '@/lib/settlements';
import { downloadFile } from '@/lib/upload';

function Row({ label, value, strong }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

export default function SettlementPage({ params }) {
  const { kind, id } = use(params);
  const base = `/v1/admin/settlements/${kind}/${id}`;
  const q = useQuery({ queryKey: ['settlement', kind, id], queryFn: () => api.get(base) });
  const [asking, setAsking] = useState(null); // 'approve' | 'paid' | 'fail' | 'cancel'
  const act = useApiMutation({
    mutationFn: ({ step, body }) => api.post(`${base}/${step}`, body),
    invalidate: [['settlement', kind, id], ['settlements']],
    success: (_d, v) =>
      ({
        approve: 'Approved — pay it and record the reference',
        paid: 'Recorded as paid',
        fail: 'Marked failed — entries go to the next run',
        cancel: 'Cancelled — entries go to the next run',
      })[v.step],
    onSuccess: () => setAsking(null),
  });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const [label, tone] = SETTLEMENT_STATUS[s.status] ?? [s.status, 'neutral'];
  const lastDay = dateOnly(new Date(new Date(s.periodEnd).getTime() - 1));
  const manage = s.permissions.manage;
  return (
    <>
      <PageHeader
        back={{ href: '/settlements', label: 'Settlements' }}
        title={`${s.name} · ${dateOnly(s.periodStart)} – ${lastDay}`}
        description={
          kind === 'restaurant'
            ? `Restaurant settlement (${s.schedule.toLowerCase().replaceAll('_', ' ')})`
            : 'Delivery partner settlement'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                downloadFile(`${base}/statement.csv`, `jamzo-${kind}-settlement-${lastDay}.csv`).catch((e) =>
                  toast.error(e.message),
                )
              }
            >
              Download statement (CSV)
            </Button>
            {manage && s.status === 'DRAFT' ? (
              <Button onClick={() => setAsking('approve')}>Approve</Button>
            ) : null}
            {manage && s.status === 'PROCESSING' ? (
              <Button onClick={() => setAsking('paid')}>Record payout</Button>
            ) : null}
            {manage && s.status === 'PROCESSING' ? (
              <Button variant="outline" onClick={() => setAsking('fail')}>
                Payout failed
              </Button>
            ) : null}
            {manage && ['DRAFT', 'PROCESSING'].includes(s.status) ? (
              <Button variant="outline" onClick={() => setAsking('cancel')}>
                Cancel
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="mb-2">
              <StatusBadge tone={tone}>{label}</StatusBadge>
            </p>
            {kind === 'restaurant' ? (
              <>
                <Row label="Carried from earlier" value={formatPaise(s.openingPaise)} />
                <Row label="Food sales" value={formatPaise(s.grossSalesPaise)} />
                <Row label="Commission" value={`− ${formatPaise(s.commissionPaise)}`} />
                <Row label="Tax on commission" value={`− ${formatPaise(s.taxesPaise)}`} />
                <Row
                  label="Discounts funded by the restaurant"
                  value={`− ${formatPaise(s.discountsPaise)}`}
                />
                <Row label="Tax withheld" value={`− ${formatPaise(s.withholdingPaise)}`} />
                <Row label="Refunds" value={`− ${formatPaise(s.refundsPaise)}`} />
                <Row label="Adjustments and compensation" value={formatPaise(s.adjustmentsPaise)} />
              </>
            ) : (
              <>
                <Row label="Earnings" value={formatPaise(s.earningsPaise)} />
                <Row label="Cash on delivery netted" value={`− ${formatPaise(s.codOwedPaise)}`} />
              </>
            )}
            <Row label="To pay" value={formatPaise(s.netPayablePaise)} strong />
            {s.payoutReference ? <Row label="Payout reference" value={s.payoutReference} /> : null}
            {s.paidAt ? <Row label="Paid" value={formatDateTime(s.paidAt)} /> : null}
            {s.note ? <Row label="Note" value={s.note} /> : null}
            <p className="mt-3 text-xs text-muted-foreground">
              Amounts are placeholders until the owner and the CA confirm commission and tax (A-16, Q-3).
            </p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Ledger entries ({s.entries.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatDateTime(e.createdAt)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {e.orderId ? <Link href={`/orders/${e.orderId}`}>{e.orderNumber}</Link> : '—'}
                    </TableCell>
                    <TableCell>
                      {ENTRY_TYPE[e.type] ?? e.type}
                      {e.description ? (
                        <span className="text-muted-foreground"> · {e.description}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPaise(signedPaise(e))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={asking === 'approve'}
        onOpenChange={(o) => !o && setAsking(null)}
        title="Approve this settlement?"
        description={`Pay ${formatPaise(s.netPayablePaise)} to ${s.name} outside Jamzo (bank transfer or UPI), then record the reference here.`}
        confirmLabel="Approve"
        busy={act.isPending}
        onConfirm={() => act.mutate({ step: 'approve' })}
      />
      <ConfirmDialog
        open={asking === 'fail' || asking === 'cancel'}
        onOpenChange={(o) => !o && setAsking(null)}
        title={asking === 'fail' ? 'Mark the payout as failed?' : 'Cancel this settlement?'}
        description="Its entries go back to the next run. Say why; it is recorded."
        confirmLabel={asking === 'fail' ? 'Payout failed' : 'Cancel settlement'}
        destructive
        requireReason
        busy={act.isPending}
        onConfirm={(note) => act.mutate({ step: asking, body: { note } })}
      />
      {asking === 'paid' ? (
        <PaidDialog
          refund={{ amountPaise: s.netPayablePaise }}
          title="Record the payout"
          intro={`Pay ${formatPaise(s.netPayablePaise)} to ${s.name} by bank transfer or UPI first, then enter its reference. Recorded in the audit log.`}
          busy={act.isPending}
          onClose={() => setAsking(null)}
          onSave={(reference) => act.mutate({ step: 'paid', body: { reference } })}
        />
      ) : null}
    </>
  );
}
