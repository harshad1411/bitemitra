'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/jamzo/page-header';
import { ProductForm } from '@/components/products/product-form';

function NewProduct() {
  const params = useSearchParams();
  const restaurantId = params.get('restaurantId');
  return (
    <>
      <PageHeader
        back={
          restaurantId
            ? { href: `/restaurants/${restaurantId}?tab=menu`, label: 'Menu' }
            : { href: '/products', label: 'Products' }
        }
        title="Add product"
      />
      <ProductForm restaurantId={restaurantId ?? undefined} />
    </>
  );
}

export default function NewProductPage() {
  return (
    <Suspense>
      <NewProduct />
    </Suspense>
  );
}
