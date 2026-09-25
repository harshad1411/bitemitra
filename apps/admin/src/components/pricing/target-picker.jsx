'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';

/** Picks the target of a rule scope: a city, zone, restaurant, food category or product. */
export function TargetPicker({ scope, value, onChange, id }) {
  const [cityId, setCityId] = useState('');
  const [q, setQ] = useState('');
  const cities = useQuery({
    queryKey: ['cities', 'options'],
    queryFn: () => api.get('/v1/admin/geo/cities', { limit: 100 }),
    enabled: ['CITY', 'ZONE'].includes(scope),
  });
  const city = useQuery({
    queryKey: ['city', cityId],
    queryFn: () => api.get(`/v1/admin/geo/cities/${cityId}`),
    enabled: scope === 'ZONE' && Boolean(cityId),
  });
  const restaurants = useQuery({
    queryKey: ['restaurants', 'options'],
    queryFn: () => api.get('/v1/admin/restaurants', { limit: 100 }),
    enabled: scope === 'RESTAURANT',
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get('/v1/admin/categories'),
    enabled: scope === 'CATEGORY',
  });
  const products = useQuery({
    queryKey: ['products', 'picker', q],
    queryFn: () => api.get('/v1/admin/products', { q: q || undefined, limit: 30 }),
    enabled: scope === 'PRODUCT',
  });

  const select = (options, placeholder) => (
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
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

  if (scope === 'GLOBAL')
    return (
      <p className="text-sm text-muted-foreground">Applies everywhere unless a more specific rule exists.</p>
    );
  if (scope === 'CITY')
    return select(
      (cities.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
      'Choose a city',
    );
  if (scope === 'ZONE')
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={cityId} onValueChange={setCityId}>
          <SelectTrigger aria-label="City of the zone" className="w-full">
            <SelectValue placeholder="City" />
          </SelectTrigger>
          <SelectContent>
            {(cities.data?.items ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {select(
          (city.data?.zones ?? []).map((z) => ({ value: z.id, label: z.name })),
          'Zone',
        )}
      </div>
    );
  if (scope === 'RESTAURANT')
    return select(
      (restaurants.data?.items ?? []).map((r) => ({ value: r.id, label: r.name })),
      'Choose a restaurant',
    );
  if (scope === 'CATEGORY')
    return select(
      (categories.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
      'Choose a food category',
    );
  return (
    <div className="grid gap-2">
      <Input
        aria-label="Search products"
        placeholder="Search products"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {select(
        (products.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${p.restaurant.name}` })),
        'Choose a product',
      )}
    </div>
  );
}
