'use client';

import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { ProductForm } from '@/components/products/product-form';
import { api } from '@/lib/api';
import { availabilityText } from '@/lib/restaurants';
import { useAuth } from '@/lib/auth';
import { formatPaise } from '@jamzo/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ProductPage({ params }) {
  const { id } = use(params);
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api.get(`/v1/admin/products/${id}`) });
  // Customer price with the live rules (PRICING.md §9) — the same engine function the apps and cart use.
  const price = useQuery({
    queryKey: ['pricing', 'preview', q.data?.restaurant.id, q.data?.version],
    queryFn: () => api.post('/v1/admin/pricing/preview', { restaurantId: q.data.restaurant.id }),
    enabled: Boolean(q.data) && can('pricing.view'),
  });
  const mine = price.data?.items.find((i) => i.productId === id);
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const a = availabilityText(p.availability);
  return (
    <>
      <PageHeader
        back={{ href: `/restaurants/${p.restaurant.id}?tab=menu`, label: p.restaurant.name }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {p.name} <StatusBadge tone={a.tone}>{a.text}</StatusBadge>
          </span>
        }
        description={
          <>
            <Link href={`/restaurants/${p.restaurant.id}`} className="hover:underline">
              {p.restaurant.name}
            </Link>{' '}
            · version {p.version}
          </>
        }
      />
      {mine ? (
        <Alert className="mb-4">
          <AlertDescription>
            Customer price now: <strong>{formatPaise(mine.current.customerPricePaise)}</strong> (restaurant
            price {formatPaise(mine.restaurantPricePaise)}
            {mine.current.markupPaise ? `, markup ${formatPaise(mine.current.markupPaise)}` : ', no markup'})
            · commission {formatPaise(mine.current.commissionPaise)} per item. Taxes and fees are added in the
            cart.
          </AlertDescription>
        </Alert>
      ) : null}
      <ProductForm key={`${p.id}:${p.version}`} product={p} />
    </>
  );
}
