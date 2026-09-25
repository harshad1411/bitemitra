'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { METHOD, PAYMENT_STATUS } from '@/lib/payments';

const columns = [
  {
    header: 'Order',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.orderNumber}</span>,
  },
  { header: 'Restaurant', cell: ({ row }) => row.original.restaurant },
  { header: 'Method', cell: ({ row }) => METHOD[row.original.method] ?? row.original.method },
  {
    header: 'Status',
    cell: ({ row }) => {
      const [label, tone] = PAYMENT_STATUS[row.original.status] ?? [row.original.status, 'neutral'];
      return <StatusBadge tone={tone}>{label}</StatusBadge>;
    },
  },
  {
    header: 'Amount',
    cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.amountPaise)}</span>,
  },
  {
    header: 'Refunded',
    cell: ({ row }) =>
      row.original.refundedPaise ? (
        <span className="tabular-nums">{formatPaise(row.original.refundedPaise)}</span>
      ) : (
        '—'
      ),
  },
  {
    header: 'Gateway fee',
    cell: ({ row }) =>
      row.original.gatewayFeePaise != null ? (
        <span className="tabular-nums">{formatPaise(row.original.gatewayFeePaise)}</span>
      ) : (
        '—'
      ),
  },
  { header: 'Created', cell: ({ row }) => formatDateTime(row.original.createdAt) },
];

export default function PaymentsPage() {
  const router = useRouter();
  const [status, setStatus] = useState('ALL');
  return (
    <>
      <PageHeader
        title="Payments"
        description="Every payment attempt, confirmed only by the server with the gateway (never by the app). Cash on delivery appears once collected."
      />
      <ResourceTable
        queryKey={['payments']}
        fetchPage={(p) => api.get('/v1/admin/payments', p)}
        columns={columns}
        filters={status === 'ALL' ? {} : { status }}
        refetchInterval={30_000}
        searchPlaceholder="Order number or gateway id"
        toolbar={
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-52" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {Object.entries(PAYMENT_STATUS).map(([v, [l]]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        onRowClick={(r) => router.push(`/payments/${r.id}`)}
        rowLabel={(r) => `Open payment for ${r.orderNumber}`}
        empty={
          <EmptyState
            icon={CreditCard}
            title="No payments"
            description="Payments appear when customers pay online or cash is collected."
          />
        }
      />
    </>
  );
}
