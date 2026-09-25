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

export default function ProductPage({ params }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['product', id], queryFn: () => api.get(`/v1/admin/products/${id}`) });
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
      <ProductForm key={`${p.id}:${p.version}`} product={p} />
    </>
  );
}
