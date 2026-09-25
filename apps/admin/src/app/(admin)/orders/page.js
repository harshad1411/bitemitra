'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { formatPaise, parseRupeesToPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { FormField } from '@/components/jamzo/form-field';
import { PageHeader } from '@/components/jamzo/page-header';
import { PriceInput } from '@/components/jamzo/price-input';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime, titleCase } from '@/lib/format';
import { ORDER_VIEWS, statusLabel, statusTone } from '@/lib/orders';
import { DELIVERY_STATUS } from '@/lib/riders';
import { downloadFile } from '@/lib/upload';

const MONEY = {
  NONE: 'No refund',
  REFUND_PENDING: 'Refund pending',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
};

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
  {
    header: 'Delivery',
    cell: ({ row }) => DELIVERY_STATUS[row.original.deliveryStatus] ?? titleCase(row.original.deliveryStatus),
  },
  { header: 'Money', cell: ({ row }) => MONEY[row.original.financialStatus] ?? '—' },
  { header: 'City', cell: ({ row }) => row.original.city ?? '—' },
];

/** The filter controls as query parameters (what saved views store and the export uses). */
function toQuery(s) {
  return {
    ...ORDER_VIEWS.find((v) => v.value === s.view).filters,
    ...(s.payment === 'ALL' ? {} : { paymentMethod: s.payment }),
    ...(s.delivery === 'ALL' ? {} : { deliveryStatus: s.delivery }),
    ...(s.money === 'ALL' ? {} : { financialStatus: s.money }),
    ...(parseRupeesToPaise(s.min) != null ? { minTotalPaise: String(parseRupeesToPaise(s.min)) } : {}),
    ...(parseRupeesToPaise(s.max) != null ? { maxTotalPaise: String(parseRupeesToPaise(s.max)) } : {}),
  };
}
const START = { view: 'ALL', payment: 'ALL', delivery: 'ALL', money: 'ALL', min: '', max: '' };

function SaveViewDialog({ query, onClose }) {
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const m = useApiMutation({
    mutationFn: () =>
      api.post('/v1/admin/saved-views', { resource: 'orders', name: name.trim(), query, isShared: shared }),
    invalidate: [['saved-views']],
    success: 'View saved',
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this view</DialogTitle>
          <DialogDescription>
            Saves the filters (not the search). Shared views are visible to every admin who sees orders.
          </DialogDescription>
        </DialogHeader>
        <FormField id="view-name" label="Name">
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}
        </FormField>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={shared} onCheckedChange={(v) => setShared(Boolean(v))} /> Share with other admins
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={name.trim().length < 2 || m.isPending} onClick={() => m.mutate()}>
            Save view
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Orders() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useAuth();
  const [s, setS] = useState({
    ...START,
    view: ORDER_VIEWS.some((v) => v.value === params.get('view')) ? params.get('view') : 'ALL',
  });
  const set = (k) => (v) => setS((x) => ({ ...x, [k]: v }));
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [handling, setHandling] = useState(false);
  const [viewId, setViewId] = useState('NONE');
  const views = useQuery({
    queryKey: ['saved-views'],
    queryFn: () => api.get('/v1/admin/saved-views', { resource: 'orders' }),
  });
  const filters = toQuery(s);
  const del = useApiMutation({
    mutationFn: (id) => api.delete(`/v1/admin/saved-views/${id}`),
    invalidate: [['saved-views']],
    success: 'View deleted',
    onSuccess: () => setViewId('NONE'),
  });
  const bulk = useApiMutation({
    mutationFn: (note) => api.post('/v1/admin/orders/bulk/attention', { orderIds: selected, note }),
    invalidate: [['orders']],
    success: (r) =>
      `${r.handled} marked handled${r.skipped ? ` · ${r.skipped} not flagged or not yours` : ''}`,
    onSuccess: () => {
      setHandling(false);
      setSelected([]);
    },
  });
  const apply = (id) => {
    setViewId(id);
    const v = views.data?.items.find((x) => x.id === id);
    if (!v) return setS(START);
    const q = v.query;
    // The predefined view whose filters the saved view contains (e.g. "Needs attention").
    const view =
      ORDER_VIEWS.find((o) => {
        const e = Object.entries(o.filters);
        return e.length > 0 && e.every(([k, v]) => q[k] === v);
      })?.value ?? 'ALL';
    setS({
      view,
      payment: q.paymentMethod ?? 'ALL',
      delivery: q.deliveryStatus ?? 'ALL',
      money: q.financialStatus ?? 'ALL',
      min: q.minTotalPaise ? String(Number(q.minTotalPaise) / 100) : '',
      max: q.maxTotalPaise ? String(Number(q.maxTotalPaise) / 100) : '',
    });
  };
  const current = views.data?.items.find((x) => x.id === viewId);
  return (
    <>
      <PageHeader
        title="Orders"
        description="Live list, refreshed every 15 seconds. Filter, save views, export, and mark flagged orders handled in bulk."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                downloadFile(
                  `/v1/admin/orders/export.csv?${new URLSearchParams(filters)}`,
                  'jamzo-orders.csv',
                ).catch((e) => toast.error(e.message))
              }
            >
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => setSaving(true)}>
              Save view
            </Button>
          </div>
        }
      />
      <ResourceTable
        queryKey={['orders']}
        fetchPage={(p) => api.get('/v1/admin/orders', p)}
        columns={columns}
        filters={filters}
        refetchInterval={15_000}
        searchPlaceholder="Order number, restaurant, customer or partner name, or phone"
        selection={can('orders.edit') ? { selected, onChange: setSelected } : undefined}
        toolbar={
          <div className="flex flex-wrap items-end gap-2">
            <Select value={viewId} onValueChange={apply}>
              <SelectTrigger className="w-48" aria-label="Saved filters">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No saved view</SelectItem>
                {(views.data?.items ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    {v.isShared ? ' (shared)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {current?.mine ? (
              <Button variant="ghost" size="sm" onClick={() => del.mutate(current.id)}>
                Delete view
              </Button>
            ) : null}
            <Select value={s.view} onValueChange={set('view')}>
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
            <Select value={s.payment} onValueChange={set('payment')}>
              <SelectTrigger className="w-40" aria-label="Payment method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All payments</SelectItem>
                <SelectItem value="COD">Cash on delivery</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="NETBANKING">Netbanking</SelectItem>
                <SelectItem value="WALLET">Wallet</SelectItem>
              </SelectContent>
            </Select>
            <Select value={s.delivery} onValueChange={set('delivery')}>
              <SelectTrigger className="w-48" aria-label="Delivery">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any delivery status</SelectItem>
                {Object.entries(DELIVERY_STATUS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={s.money} onValueChange={set('money')}>
              <SelectTrigger className="w-40" aria-label="Money">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Any refunds</SelectItem>
                {Object.entries(MONEY).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PriceInput
              className="w-28"
              aria-label="Minimum total"
              placeholder="Min"
              value={s.min}
              onChange={set('min')}
            />
            <PriceInput
              className="w-28"
              aria-label="Maximum total"
              placeholder="Max"
              value={s.max}
              onChange={set('max')}
            />
            {selected.length ? (
              <Button size="sm" onClick={() => setHandling(true)}>
                Mark handled ({selected.length})
              </Button>
            ) : null}
          </div>
        }
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        rowLabel={(o) => `Open order ${o.orderNumber}`}
        empty={
          <EmptyState
            icon={ShoppingBag}
            title="No orders here"
            description="Orders appear as soon as customers place them. Try other filters."
          />
        }
      />
      {saving ? <SaveViewDialog query={filters} onClose={() => setSaving(false)} /> : null}
      <ConfirmDialog
        open={handling}
        onOpenChange={setHandling}
        title={`Mark ${selected.length} orders as handled?`}
        description="Only orders flagged as needing attention change. The note is added to each order and recorded."
        confirmLabel="Mark handled"
        requireReason
        busy={bulk.isPending}
        onConfirm={(note) => bulk.mutate(note)}
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
