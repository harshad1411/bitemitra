'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { METHOD, PAYMENT_STATUS, REFUND_STATUS, REFUND_TYPE } from '@/lib/payments';

const OUTCOME = {
  CONFIRMED: 'The gateway confirmed the payment; the order is placed.',
  ALREADY: 'Already up to date.',
  WAITING: 'The gateway has no completed payment yet.',
  ATTEMPT_FAILED: 'The last try failed; the customer can still pay.',
  MISMATCH: 'The gateway reports a different amount. The order is flagged; do not confirm it by hand.',
  LATE_REFUND: 'Paid after the order ended: a full refund was created.',
  NO_GATEWAY_ORDER: 'No gateway order exists yet.',
  SKIPPED: 'Nothing to check for cash on delivery.',
};

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export default function PaymentPage({ params }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['payment', id], queryFn: () => api.get(`/v1/admin/payments/${id}`) });
  const check = useApiMutation({
    mutationFn: () => api.post(`/v1/admin/payments/${id}/reconcile`),
    invalidate: [['payment', id], ['payments']],
    success: (d) => OUTCOME[d.outcome] ?? d.outcome,
  });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const [label, tone] = PAYMENT_STATUS[p.status] ?? [p.status, 'neutral'];
  return (
    <>
      <PageHeader
        back={{ href: '/payments', label: 'Payments' }}
        title={`Payment for ${p.orderNumber}`}
        description={`${p.restaurant} · ${p.provider === 'cod' ? 'Cash on delivery' : `Online (${p.provider})`}`}
        actions={
          p.permissions.reconcile && p.provider !== 'cod' ? (
            <Button variant="outline" disabled={check.isPending} onClick={() => check.mutate()}>
              Check with gateway
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="mb-2">
              <StatusBadge tone={tone}>{label}</StatusBadge>
            </p>
            <Row label="Method">{METHOD[p.method] ?? p.method}</Row>
            <Row label="Amount">{formatPaise(p.amountPaise)}</Row>
            <Row label="Captured">{formatPaise(p.capturedPaise)}</Row>
            <Row label="Refunded">{formatPaise(p.refundedPaise)}</Row>
            <Row label="Gateway fee (incl. tax)">
              {p.gatewayFeePaise != null ? formatPaise(p.gatewayFeePaise) : 'not reported yet'}
            </Row>
            <Row label="Of which tax">{p.gatewayTaxPaise != null ? formatPaise(p.gatewayTaxPaise) : '—'}</Row>
            {p.expiresAt ? <Row label="Expires">{formatDateTime(p.expiresAt)}</Row> : null}
            {p.succeededAt ? <Row label="Paid">{formatDateTime(p.succeededAt)}</Row> : null}
            {p.failureReason ? <Row label="Last problem">{p.failureReason}</Row> : null}
            <Row label="Gateway order">
              <span className="font-mono text-xs">{p.providerOrderId ?? '—'}</span>
            </Row>
            <Row label="Gateway payment">
              <span className="font-mono text-xs">{p.providerPaymentId ?? '—'}</span>
            </Row>
            <p className="mt-3">
              <Link className="underline" href={`/orders/${p.orderId}`}>
                Open the order
              </Link>
            </p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tries at the gateway</CardTitle>
          </CardHeader>
          <CardContent>
            {p.attempts.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Gateway id</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.attempts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>{formatDateTime(a.createdAt)}</TableCell>
                      <TableCell>{PAYMENT_STATUS[a.status]?.[0] ?? a.status}</TableCell>
                      <TableCell className="font-mono text-xs">{a.providerPaymentId}</TableCell>
                      <TableCell>{a.errorMessage ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No tries yet.</p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Messages from the gateway</CardTitle>
          </CardHeader>
          <CardContent>
            {p.events.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Received</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Handled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{formatDateTime(e.receivedAt)}</TableCell>
                      <TableCell className="font-mono text-xs">{e.eventType}</TableCell>
                      <TableCell>
                        {e.processingError ? (
                          <StatusBadge tone="critical">{e.processingError}</StatusBadge>
                        ) : e.processedAt ? (
                          formatDateTime(e.processedAt)
                        ) : (
                          'waiting'
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                None received. The server also checks with the gateway every two minutes while a payment is
                open.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Refunds</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {p.refunds.length ? (
              p.refunds.map((r) => (
                <div key={r.id} className="flex justify-between gap-2">
                  <span>
                    {REFUND_TYPE[r.type]} · {formatPaise(r.amountPaise)}
                  </span>
                  <StatusBadge tone={REFUND_STATUS[r.status]?.[1] ?? 'neutral'}>
                    {REFUND_STATUS[r.status]?.[0] ?? r.status}
                  </StatusBadge>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No refunds.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
