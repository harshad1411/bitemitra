'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banknote } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { DEPOSIT_METHOD, DEPOSIT_STATUS } from '@/lib/settlements';

export default function CodDepositsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [status, setStatus] = useState('PENDING');
  const [action, setAction] = useState(null); // { kind: 'verify' | 'reject', deposit }
  const act = useApiMutation({
    mutationFn: ({ kind, deposit, note }) =>
      api.post(`/v1/admin/cod-deposits/${deposit.id}/${kind}`, kind === 'reject' ? { note } : undefined),
    invalidate: [['cod-deposits']],
    success: (_d, v) => (v.kind === 'verify' ? 'Deposit verified' : 'Deposit rejected'),
    onSuccess: () => setAction(null),
  });
  const columns = [
    { header: 'Delivery partner', cell: ({ row }) => row.original.riderName ?? '—' },
    {
      header: 'Amount',
      cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.amountPaise)}</span>,
    },
    { header: 'How', cell: ({ row }) => DEPOSIT_METHOD[row.original.method] },
    {
      header: 'Reference',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference ?? '—'}</span>,
    },
    {
      header: 'Status',
      cell: ({ row }) => {
        const [label, tone] = DEPOSIT_STATUS[row.original.status];
        return <StatusBadge tone={tone}>{label}</StatusBadge>;
      },
    },
    {
      header: 'Cash held now',
      cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.codHeldPaise)}</span>,
    },
    {
      header: 'Reported',
      cell: ({ row }) =>
        `${formatDateTime(row.original.createdAt)} · ${row.original.reportedBy === 'ADMIN' ? 'hub' : 'partner'}`,
    },
    {
      header: <span className="sr-only">Actions</span>,
      id: 'actions',
      cell: ({ row }) =>
        row.original.status === 'PENDING' && can('settlements.manage') ? (
          <div className="flex justify-end gap-1">
            {['verify', 'reject'].map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant={kind === 'verify' ? 'default' : 'outline'}
                aria-label={`${kind === 'verify' ? 'Verify' : 'Reject'} ${formatPaise(row.original.amountPaise)} from ${row.original.riderName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setAction({ kind, deposit: row.original });
                }}
              >
                {kind === 'verify' ? 'Verify' : 'Reject'}
              </Button>
            ))}
          </div>
        ) : null,
    },
  ];
  const a = action;
  return (
    <>
      <PageHeader
        title="Cash deposits"
        description="Cash on delivery handed over by delivery partners (UPI, bank or at a hub). Check the money arrived before verifying: verified cash is taken off what the partner holds."
      />
      <ResourceTable
        queryKey={['cod-deposits']}
        fetchPage={(p) => api.get('/v1/admin/cod-deposits', p)}
        columns={columns}
        filters={status === 'ALL' ? {} : { status }}
        toolbar={
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              {Object.entries(DEPOSIT_STATUS).map(([v, [l]]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        onRowClick={(r) => router.push(`/riders/${r.riderId}`)}
        rowLabel={(r) => `Open ${r.riderName}`}
        empty={
          <EmptyState
            icon={Banknote}
            title="No deposits"
            description="Deposits appear when partners report them or a hub records cash."
          />
        }
      />
      <ConfirmDialog
        open={a?.kind === 'verify'}
        onOpenChange={(o) => !o && setAction(null)}
        title="Verify this deposit?"
        description={
          a
            ? `Only if ${formatPaise(a.deposit.amountPaise)} (${DEPOSIT_METHOD[a.deposit.method]} ${a.deposit.reference ?? ''}) has really arrived.`
            : ''
        }
        confirmLabel="Verify"
        busy={act.isPending}
        onConfirm={() => act.mutate(a)}
      />
      <ConfirmDialog
        open={a?.kind === 'reject'}
        onOpenChange={(o) => !o && setAction(null)}
        title="Reject this deposit?"
        description="The partner sees your reason and still holds the cash."
        confirmLabel="Reject deposit"
        destructive
        requireReason
        busy={act.isPending}
        onConfirm={(note) => act.mutate({ ...a, note })}
      />
    </>
  );
}
