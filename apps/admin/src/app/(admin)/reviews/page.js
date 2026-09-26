'use client';

// Ratings and reviews (D-110): every review with its comment, low ratings (1–2★) marked for support to
// follow up, and hiding an abusive review with a reason. Hidden reviews leave every average.
import { useState } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';

const VIEWS = {
  ALL: {},
  LOW: { low: 'true', hidden: 'false' },
  HIDDEN: { hidden: 'true' },
};
const stars = (n) => (n == null ? '—' : `${Number(n).toFixed(n % 1 ? 1 : 0)}★`);

export default function ReviewsPage() {
  const { can } = useAuth();
  const [view, setView] = useState('ALL');
  const [hiding, setHiding] = useState(null);
  const moderate = useApiMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/v1/admin/reviews/${id}`, body),
    invalidate: [['reviews']],
    success: 'Review updated — averages recalculated',
    onSuccess: () => setHiding(null),
  });
  const columns = [
    {
      header: 'Order',
      cell: ({ row }) => (
        <div className="grid gap-0.5">
          <span className="font-mono text-xs">{row.original.order.orderNumber}</span>
          <span className="text-xs text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
        </div>
      ),
    },
    { header: 'Restaurant', cell: ({ row }) => row.original.restaurant.name },
    {
      header: 'Food',
      cell: ({ row }) => (
        <div className="grid gap-0.5">
          <span className="font-medium">{stars(row.original.foodRating)}</span>
          <span className="text-xs text-muted-foreground">
            {row.original.items.map((i) => `${i.name} ${i.rating}★`).join(', ')}
          </span>
        </div>
      ),
    },
    {
      header: 'Delivery',
      cell: ({ row }) =>
        row.original.rider
          ? `${stars(row.original.deliveryRating)} · ${row.original.rider.name ?? 'Partner'}`
          : '—',
    },
    {
      header: 'Comment',
      cell: ({ row }) => <span className="line-clamp-2 max-w-xs">{row.original.comment ?? '—'}</span>,
    },
    {
      header: 'Customer',
      cell: ({ row }) => row.original.customer.name ?? row.original.customer.phone ?? '—',
    },
    {
      header: 'Status',
      cell: ({ row }) =>
        row.original.isHidden ? (
          <StatusBadge tone="neutral">{`Hidden: ${row.original.hiddenReason}`}</StatusBadge>
        ) : row.original.low ? (
          <StatusBadge tone="critical">Low rating</StatusBadge>
        ) : (
          <StatusBadge tone="success">Shown</StatusBadge>
        ),
    },
    ...(can('reviews.moderate')
      ? [
          {
            header: '',
            id: 'actions',
            cell: ({ row }) =>
              row.original.isHidden ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    moderate.mutate({ id: row.original.id, hidden: false });
                  }}
                >
                  Show again
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHiding(row.original);
                  }}
                >
                  Hide
                </Button>
              ),
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader
        title="Reviews"
        description="Ratings customers gave after delivery. Customers only ever see star averages, from 5 ratings; comments are seen by the restaurant and Jamzo."
      />
      <Tabs value={view} onValueChange={setView} className="mb-4">
        <TabsList>
          <TabsTrigger value="ALL">All</TabsTrigger>
          <TabsTrigger value="LOW">Low ratings (1–2★)</TabsTrigger>
          <TabsTrigger value="HIDDEN">Hidden</TabsTrigger>
        </TabsList>
      </Tabs>
      <ResourceTable
        key={view}
        queryKey={['reviews', view]}
        fetchPage={(p) => api.get('/v1/admin/reviews', p)}
        columns={columns}
        filters={VIEWS[view]}
        empty={
          <EmptyState
            icon={Star}
            title="No reviews here"
            description="Reviews appear once customers rate their delivered orders."
          />
        }
      />
      <ConfirmDialog
        open={Boolean(hiding)}
        onOpenChange={(v) => !v && setHiding(null)}
        title="Hide this review?"
        description="It leaves the restaurant's, the dishes' and the delivery partner's averages, and the restaurant no longer sees it. Say why; this is recorded in the audit log."
        confirmLabel="Hide review"
        destructive
        requireReason
        busy={moderate.isPending}
        onConfirm={(reason) => moderate.mutate({ id: hiding.id, hidden: true, reason })}
      />
    </>
  );
}
