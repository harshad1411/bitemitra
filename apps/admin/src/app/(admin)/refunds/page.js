'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Receipt } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { PaidDialog } from '@/components/payments/paid-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { BEARER, REFUND_STATUS, REFUND_TYPE } from '@/lib/payments';

export default function RefundsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [status, setStatus] = useState('ALL');
  const [action, setAction] = useState(null); // { kind: 'approve' | 'reject' | 'retry' | 'paid', refund }
  const act = useApiMutation({
    mutationFn: ({ kind, refund, reason, reference }) =>
      api.post(
        `/v1/admin/refunds/${refund.id}/${kind}`,
        kind === 'reject' ? { reason } : kind === 'paid' ? { reference } : undefined,
      ),
    invalidate: [['refunds'], ['order'], ['payments']],
    success: (_d, v) =>
      ({
        approve: 'Refund approved',
        reject: 'Refund rejected',
        retry: 'Refund sent again',
        paid: 'Refund recorded as paid',
      })[v.kind],
    onSuccess: () => setAction(null),
  });
  const button = (kind, refund, label, variant = 'outline') => (
    <Button
      size="sm"
      variant={variant}
      aria-label={`${label} ${refund.orderNumber}`}
      onClick={(e) => {
        e.stopPropagation();
        setAction({ kind, refund });
      }}
    >
      {label}
    </Button>
  );
  const columns = [
    {
      header: 'Order',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.orderNumber}</span>,
    },
    { header: 'Type', cell: ({ row }) => REFUND_TYPE[row.original.type] ?? row.original.type },
    {
      header: 'Amount',
      cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.amountPaise)}</span>,
    },
    {
      header: 'Status',
      cell: ({ row }) => {
        const [label, tone] = REFUND_STATUS[row.original.status] ?? [row.original.status, 'neutral'];
        return <StatusBadge tone={tone}>{label}</StatusBadge>;
      },
    },
    { header: 'Paid by', cell: ({ row }) => BEARER[row.original.bearer] },
    {
      header: 'Reason',
      cell: ({ row }) => (
        <span className="line-clamp-2 max-w-64">
          {row.original.reason}
          {row.original.failureReason ? ` — ${row.original.failureReason}` : ''}
        </span>
      ),
    },
    { header: 'Created', cell: ({ row }) => formatDateTime(row.original.createdAt) },
    {
      header: <span className="sr-only">Actions</span>,
      id: 'actions',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="flex justify-end gap-1">
            {r.status === 'PENDING_APPROVAL' && r.canApprove ? (
              <>
                {button('approve', r, 'Approve', 'default')}
                {button('reject', r, 'Reject')}
              </>
            ) : null}
            {r.status === 'PENDING_APPROVAL' && !r.canApprove ? (
              <span className="text-xs text-muted-foreground">Another admin approves</span>
            ) : null}
            {r.status === 'FAILED' && r.paymentId && can('refunds.approve')
              ? button('retry', r, 'Retry')
              : null}
            {r.status === 'REQUESTED' && !r.paymentId && can('refunds.create')
              ? button('paid', r, 'Mark paid')
              : null}
          </div>
        );
      },
    },
  ];
  const a = action;
  return (
    <>
      <PageHeader
        title="Refunds"
        description="Online refunds go back through the payment gateway; cash-on-delivery refunds are paid by UPI or bank transfer and recorded here. Refunds above the approval limit need a second admin."
      />
      <ResourceTable
        queryKey={['refunds']}
        fetchPage={(p) => api.get('/v1/admin/refunds', p)}
        columns={columns}
        filters={status === 'ALL' ? {} : { status }}
        refetchInterval={30_000}
        searchPlaceholder="Order number"
        toolbar={
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-52" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {Object.entries(REFUND_STATUS).map(([v, [l]]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        onRowClick={(r) => router.push(`/orders/${r.orderId}`)}
        rowLabel={(r) => `Open order ${r.orderNumber}`}
        empty={
          <EmptyState
            icon={Receipt}
            title="No refunds"
            description="Refunds appear here when they are created."
          />
        }
      />
      <ConfirmDialog
        open={a?.kind === 'approve' || a?.kind === 'retry'}
        onOpenChange={(o) => !o && setAction(null)}
        title={a?.kind === 'retry' ? 'Send this refund again?' : 'Approve this refund?'}
        description={
          a
            ? `${formatPaise(a.refund.amountPaise)} for order ${a.refund.orderNumber}: ${a.refund.reason}`
            : ''
        }
        confirmLabel={a?.kind === 'retry' ? 'Send again' : 'Approve refund'}
        busy={act.isPending}
        onConfirm={() => act.mutate(a)}
      />
      <ConfirmDialog
        open={a?.kind === 'reject'}
        onOpenChange={(o) => !o && setAction(null)}
        title="Reject this refund?"
        description="The customer is not refunded. Say why; it is recorded."
        confirmLabel="Reject refund"
        destructive
        requireReason
        busy={act.isPending}
        onConfirm={(reason) => act.mutate({ ...a, reason })}
      />
      {a?.kind === 'paid' ? (
        <PaidDialog
          refund={a.refund}
          busy={act.isPending}
          onClose={() => setAction(null)}
          onSave={(reference) => act.mutate({ ...a, reference })}
        />
      ) : null}
    </>
  );
}
