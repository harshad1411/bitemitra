'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, UtensilsCrossed } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState } from '@/components/jamzo/states';
import { FOOD_TYPE_OPTIONS, FoodTypeMark } from '@/components/jamzo/food-type';
import { api, apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { availabilityText } from '@/lib/restaurants';

const columns = [
  {
    header: 'Product',
    cell: ({ row }) => {
      const p = row.original;
      return (
        <div className="flex items-center gap-3">
          <div className="size-9 shrink-0 overflow-hidden rounded bg-muted">
            {p.image ? (
              <img
                src={apiUrl(p.image.urls.thumb ?? p.image.urls.original)}
                alt=""
                className="size-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium">
              <FoodTypeMark type={p.foodType} /> {p.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {p.restaurant.name}
              {p.menuCategory ? ` · ${p.menuCategory.name}` : ''}
            </p>
          </div>
        </div>
      );
    },
  },
  {
    header: 'Price',
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.variants.length ? 'from ' : ''}
        {formatPaise(row.original.basePricePaise)}
      </span>
    ),
  },
  {
    header: 'Status',
    cell: ({ row }) => {
      const s = row.original.status;
      return (
        <StatusBadge tone={s === 'ACTIVE' ? 'success' : 'neutral'}>
          {s === 'ACTIVE' ? 'Active' : s === 'DRAFT' ? 'Draft' : 'Archived'}
        </StatusBadge>
      );
    },
  },
  {
    header: 'Availability',
    cell: ({ row }) => {
      const a = availabilityText(row.original.availability);
      return <StatusBadge tone={a.tone}>{a.text}</StatusBadge>;
    },
  },
];

const BULK = [
  { action: 'SOLD_OUT', label: 'Mark sold out' },
  { action: 'AVAILABLE', label: 'Back in stock' },
  { action: 'ACTIVATE', label: 'Activate' },
  { action: 'DRAFT', label: 'Move to draft' },
  { action: 'ARCHIVE', label: 'Archive', destructive: true },
];

export default function ProductsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [filters, setFilters] = useState({
    restaurantId: 'ALL',
    status: 'ALL',
    available: 'ALL',
    foodType: 'ALL',
  });
  const [selected, setSelected] = useState([]);
  const [bulk, setBulk] = useState(null);
  const restaurants = useQuery({
    queryKey: ['restaurants', 'options'],
    queryFn: () => api.get('/v1/admin/restaurants', { limit: 100 }),
  });
  const apiFilters = Object.fromEntries(
    Object.entries(filters).map(([k, v]) => [k, v === 'ALL' ? undefined : v]),
  );
  const run = useApiMutation({
    mutationFn: ({ action }) => api.post('/v1/admin/products/bulk', { ids: selected, action }),
    invalidate: [['products'], ['menu']],
    success: (r) => `${r.updated} product${r.updated === 1 ? '' : 's'} updated`,
    onSuccess: () => {
      setSelected([]);
      setBulk(null);
    },
  });
  const select = (key, label, options, width = 'w-40') => (
    <Select value={filters[key]} onValueChange={(v) => setFilters((f) => ({ ...f, [key]: v }))}>
      <SelectTrigger className={width} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <>
      <PageHeader
        title="Products"
        description="Every menu item across restaurants. Prices here are the restaurant’s own prices; customer prices (markup, tax) are calculated from Phase 4."
        actions={
          can('products.manage') ? (
            <Button asChild>
              <Link href="/products/new">
                <Plus /> Add product
              </Link>
            </Button>
          ) : null
        }
      />
      {selected.length && can('products.manage') ? (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-accent px-3 py-2 text-sm"
          role="region"
          aria-label="Bulk actions"
        >
          <span className="font-medium">{selected.length} selected</span>
          {BULK.map((b) => (
            <Button
              key={b.action}
              size="sm"
              variant={b.destructive ? 'outline' : 'secondary'}
              onClick={() => setBulk(b)}
            >
              {b.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      ) : null}
      <ResourceTable
        queryKey={['products']}
        fetchPage={(p) => api.get('/v1/admin/products', p)}
        columns={columns}
        filters={apiFilters}
        searchPlaceholder="Search products or restaurants"
        selection={can('products.manage') ? { selected, onChange: setSelected } : undefined}
        toolbar={
          <div className="flex flex-wrap gap-2">
            {select(
              'restaurantId',
              'Filter by restaurant',
              [
                { value: 'ALL', label: 'All restaurants' },
                ...(restaurants.data?.items ?? []).map((r) => ({ value: r.id, label: r.name })),
              ],
              'w-48',
            )}
            {select('status', 'Filter by status', [
              { value: 'ALL', label: 'Active & draft' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'DRAFT', label: 'Draft' },
              { value: 'ARCHIVED', label: 'Archived' },
            ])}
            {select('available', 'Filter by availability', [
              { value: 'ALL', label: 'Any availability' },
              { value: 'true', label: 'Available' },
              { value: 'false', label: 'Sold out' },
            ])}
            {select(
              'foodType',
              'Filter by food type',
              [{ value: 'ALL', label: 'Any food type' }, ...FOOD_TYPE_OPTIONS],
              'w-36',
            )}
          </div>
        }
        onRowClick={(p) => router.push(`/products/${p.id}`)}
        rowLabel={(p) => `Open ${p.name}`}
        empty={
          <EmptyState
            icon={UtensilsCrossed}
            title="No products match"
            description="Change the filters or add a product."
          />
        }
      />
      <ConfirmDialog
        open={Boolean(bulk)}
        onOpenChange={(o) => !o && setBulk(null)}
        title={`${bulk?.label}: ${selected.length} product${selected.length === 1 ? '' : 's'}?`}
        description="All selected products change together, or none do if any of them cannot."
        confirmLabel={bulk?.label}
        destructive={bulk?.destructive}
        busy={run.isPending}
        onConfirm={() => run.mutate({ action: bulk.action })}
      />
    </>
  );
}
