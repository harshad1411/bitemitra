'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { RefundDialog } from '@/components/payments/refund-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { statusLabel, statusTone } from '@/lib/orders';
import { ISSUE, TICKET_STATUS } from '@/lib/support';

export default function TicketPage({ params }) {
  const { id } = use(params);
  const { can, me } = useAuth();
  const q = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get(`/v1/admin/support/tickets/${id}`),
    refetchInterval: 15_000,
  });
  const orderId = q.data?.orderId;
  const order = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get(`/v1/admin/orders/${orderId}`),
    enabled: Boolean(orderId) && can('orders.view'),
  });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [resolving, setResolving] = useState(null); // 'RESOLVED' | 'CLOSED'
  const [refunding, setRefunding] = useState(false);
  const send = useApiMutation({
    mutationFn: () => api.post(`/v1/admin/support/tickets/${id}/messages`, { body: body.trim(), internal }),
    invalidate: [['ticket', id], ['support']],
    success: internal ? 'Internal note added' : 'Reply sent — the customer gets a notification',
    onSuccess: () => {
      setBody('');
      setInternal(false);
    },
  });
  const update = useApiMutation({
    mutationFn: (patch) => api.patch(`/v1/admin/support/tickets/${id}`, patch),
    invalidate: [['ticket', id], ['support']],
    success: 'Ticket updated',
    onSuccess: () => setResolving(null),
  });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  const [label, tone] = TICKET_STATUS[t.status];
  const o = order.data;
  return (
    <>
      <PageHeader
        back={{ href: '/support', label: 'Support' }}
        title={`${t.ticketNumber} · ${ISSUE[t.issueType]}`}
        description={`${t.customer?.name ?? 'Customer'} · ${t.customer?.phone ?? ''} · opened ${formatDateTime(t.createdAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {t.assignedToId !== me?.user?.id ? (
              <Button
                variant="outline"
                onClick={() =>
                  update.mutate({
                    assignedToId: me.user.id,
                    status: t.status === 'OPEN' ? 'IN_PROGRESS' : undefined,
                  })
                }
              >
                Take it
              </Button>
            ) : null}
            {!['RESOLVED', 'CLOSED'].includes(t.status) ? (
              <Button onClick={() => setResolving('RESOLVED')}>Resolve</Button>
            ) : null}
            {t.status === 'RESOLVED' ? (
              <Button variant="outline" onClick={() => setResolving('CLOSED')}>
                Close
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Conversation <StatusBadge tone={tone}>{label}</StatusBadge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {t.messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-md border p-3 ${m.internal ? 'border-dashed bg-muted/50' : m.authorType === 'CUSTOMER' ? '' : 'bg-accent/40'}`}
              >
                <p className="mb-1 text-xs text-muted-foreground">
                  {m.authorName} · {formatDateTime(m.createdAt)}
                  {m.internal ? ' · internal note (customer cannot see it)' : ''}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
            {t.resolution ? (
              <p className="text-muted-foreground">
                Resolution: <span className="text-foreground">{t.resolution}</span>
              </p>
            ) : null}
            {t.status !== 'CLOSED' ? (
              <div className="grid gap-2">
                <Textarea
                  aria-label="Reply"
                  rows={3}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={internal ? 'A note for Jamzo staff only' : 'Your reply to the customer'}
                />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2">
                    <Checkbox checked={internal} onCheckedChange={(v) => setInternal(Boolean(v))} /> Internal
                    note
                  </label>
                  <Button disabled={!body.trim() || send.isPending} onClick={() => send.mutate()}>
                    {internal ? 'Add note' : 'Send reply'}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Owner</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <Select
                value={t.assignedToId ?? 'NONE'}
                onValueChange={(v) => update.mutate({ assignedToId: v === 'NONE' ? null : v })}
              >
                <SelectTrigger aria-label="Assigned to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Nobody</SelectItem>
                  {t.agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {t.firstResponseAt ? (
                <p className="mt-2 text-muted-foreground">First reply {formatDateTime(t.firstResponseAt)}</p>
              ) : (
                <p className="mt-2 text-muted-foreground">Not answered yet</p>
              )}
            </CardContent>
          </Card>
          {t.orderId ? (
            <Card>
              <CardHeader>
                <CardTitle>Order {t.orderNumber}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {o ? (
                  <>
                    <p>
                      <StatusBadge tone={statusTone(o.status)}>{statusLabel(o.status)}</StatusBadge>
                    </p>
                    <p>
                      {o.restaurant.name} · {formatPaise(o.totalPayablePaise)} ·{' '}
                      {o.payment?.method === 'COD' ? 'Cash' : o.payment?.method}
                    </p>
                    <ul className="list-inside list-disc text-muted-foreground">
                      {o.items.map((i) => (
                        <li key={i.id}>{`${i.quantity} × ${i.productName}`}</li>
                      ))}
                    </ul>
                    <p className="text-muted-foreground">
                      Can still be refunded: {formatPaise(o.refundablePaise)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/orders/${o.id}`}>Open the full order</Link>
                      </Button>
                      {o.permissions.refund && o.refundablePaise > 0 ? (
                        <Button size="sm" onClick={() => setRefunding(true)}>
                          Refund
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : order.isPending ? (
                  <LoadingRows rows={2} />
                ) : (
                  <Link className="underline" href={`/orders/${t.orderId}`}>
                    Open the order
                  </Link>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(resolving)}
        onOpenChange={(v) => !v && setResolving(null)}
        title={resolving === 'CLOSED' ? 'Close this ticket?' : 'Resolve this ticket?'}
        description="Say how it was resolved. If the customer writes again, a resolved ticket reopens; a closed one does not."
        confirmLabel={resolving === 'CLOSED' ? 'Close' : 'Resolve'}
        requireReason
        busy={update.isPending}
        onConfirm={(resolution) => update.mutate({ status: resolving, resolution })}
      />
      {refunding && o ? <RefundDialog order={o} onClose={() => setRefunding(false)} /> : null}
    </>
  );
}
