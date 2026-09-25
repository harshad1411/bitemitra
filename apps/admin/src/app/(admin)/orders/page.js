'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { formatDateTime, titleCase } from '@/lib/format';
import { ORDER_VIEWS, statusLabel, statusTone } from '@/lib/orders';

const columns = [
  {
    header: 'Order',
    cell: ({ row }) => (
      <span className="font-mono text-xs font-medium">
        {row.original.orderNumber}
        {row.original.needsAttention ? (
          <StatusBadge tone="critical" className="ml-2">
            Needs attention
          </StatusBadge>
        ) : null}
      </span>
    ),
  },
  { header: 'Placed', cell: ({ row }) => formatDateTime(row.original.createdAt) },
  { header: 'Customer', cell: ({ row }) => row.original.customerName ?? '—' },
  { header: 'Restaurant', cell: ({ row }) => row.original.restaurant.name },
  { header: 'Items', cell: ({ row }) => <span className="tabular-nums">{row.original.itemCount}</span> },
  {
    header: 'Total',
    cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.totalPayablePaise)}</span>,
  },
  {
    header: 'Payment',
    cell: ({ row }) => (row.original.paymentMethod === 'COD' ? 'Cash' : row.original.paymentMethod),
  },
  {
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge tone={statusTone(row.original.status)}>{statusLabel(row.original.status)}</StatusBadge>
    ),
  },
  { header: 'Kitchen', cell: ({ row }) => titleCase(row.original.restaurantStatus) },
  { header: 'Delivery', cell: ({ row }) => titleCase(row.original.deliveryStatus) },
  { header: 'City', cell: ({ row }) => row.original.city ?? '—' },
];

function Orders() {
  const router = useRouter();
  const params = useSearchParams();
  const [view, setView] = useState(
    ORDER_VIEWS.some((v) => v.value === params.get('view')) ? params.get('view') : 'ALL',
  );
  const [payment, setPayment] = useState('ALL');
  const filters = {
    ...ORDER_VIEWS.find((v) => v.value === view).filters,
    ...(payment === 'ALL' ? {} : { paymentMethod: payment }),
  };
  return (
    <>
      <PageHeader
        title="Orders"
        description="Live list, refreshed every 15 seconds. Delivery by riders starts in Phase 6, so orders currently end at “Ready for pickup”."
      />
      <ResourceTable
        queryKey={['orders']}
        fetchPage={(p) => api.get('/v1/admin/orders', p)}
        columns={columns}
        filters={filters}
        refetchInterval={15_000}
        searchPlaceholder="Order number, restaurant or customer name"
        toolbar={
          <div className="flex flex-wrap gap-2">
            <Select value={view} onValueChange={setView}>
              <SelectTrigger className="w-52" aria-label="View">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORDER_VIEWS.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={payment} onValueChange={setPayment}>
              <SelectTrigger className="w-40" aria-label="Payment method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All payments</SelectItem>
                <SelectItem value="COD">Cash on delivery</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        rowLabel={(o) => `Open order ${o.orderNumber}`}
        empty={
          <EmptyState
            icon={ShoppingBag}
            title="No orders here"
            description="Orders appear as soon as customers place them. Try another view."
          />
        }
      />
    </>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}
