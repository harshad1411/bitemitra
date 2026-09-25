'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { FormField } from '@/components/jamzo/form-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { slugify } from '@/lib/format';
import { STATUS, STATUS_OPTIONS } from '@/lib/restaurants';

const columns = [
  {
    header: 'Restaurant',
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="font-medium">{row.original.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {row.original.cuisines.join(', ') || '—'}
          {row.original.isPureVeg ? ' · Pure veg' : ''}
        </p>
      </div>
    ),
  },
  {
    header: 'City',
    cell: ({ row }) => `${row.original.city.name}${row.original.area ? ` · ${row.original.area}` : ''}`,
  },
  {
    header: 'Active products',
    cell: ({ row }) => <span className="tabular-nums">{row.original.activeProducts}</span>,
  },
  {
    header: 'Status',
    cell: ({ row }) => {
      const s = STATUS[row.original.onboardingStatus];
      return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
    },
  },
];

function useCities() {
  return useQuery({
    queryKey: ['cities', 'options'],
    queryFn: () => api.get('/v1/admin/geo/cities', { limit: 100 }),
  });
}

function CreateRestaurantDialog({ open, onOpenChange }) {
  const router = useRouter();
  const cities = useCities();
  const [form, setForm] = useState({
    cityId: '',
    name: '',
    slug: '',
    cuisines: '',
    isPureVeg: true,
    phone: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const m = useApiMutation({
    mutationFn: () =>
      api.post('/v1/admin/restaurants', {
        cityId: form.cityId,
        name: form.name,
        slug: form.slug,
        isPureVeg: form.isPureVeg,
        cuisines: form.cuisines
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        phone: form.phone || null,
      }),
    invalidate: [['restaurants']],
    success: (r) => `${r.name} created as a draft`,
    onSuccess: (r) => router.push(`/restaurants/${r.id}`),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a restaurant</DialogTitle>
          <DialogDescription>
            It starts as a draft. Add a branch, documents and a bank account, then submit it for review.
          </DialogDescription>
        </DialogHeader>
        <form
          id="create-restaurant"
          className="grid gap-3"
          onSubmit={(e) => (e.preventDefault(), m.mutate())}
        >
          <FormField id="cityId" label="City" errors={m.fieldErrors.cityId}>
            <Select value={form.cityId} onValueChange={(v) => setForm((f) => ({ ...f, cityId: v }))}>
              <SelectTrigger id="cityId" className="w-full">
                <SelectValue placeholder={cities.isPending ? 'Loading…' : 'Choose a city'} />
              </SelectTrigger>
              <SelectContent>
                {(cities.data?.items ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? '' : ' (not launched)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="r-name" label="Name" errors={m.fieldErrors.name}>
            {(a) => (
              <Input
                {...a}
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    name: e.target.value,
                    ...(slugTouched ? {} : { slug: slugify(e.target.value) }),
                  }))
                }
              />
            )}
          </FormField>
          <FormField
            id="r-slug"
            label="Slug"
            help="Used in links; lowercase letters, numbers and hyphens."
            errors={m.fieldErrors.slug}
          >
            {(a) => (
              <Input
                {...a}
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setForm((f) => ({ ...f, slug: e.target.value }));
                }}
              />
            )}
          </FormField>
          <FormField
            id="r-cuisines"
            label="Cuisines"
            help="Comma separated, e.g. Gujarati, Thali"
            errors={m.fieldErrors.cuisines}
          >
            {(a) => (
              <Input
                {...a}
                value={form.cuisines}
                onChange={(e) => setForm((f) => ({ ...f, cuisines: e.target.value }))}
              />
            )}
          </FormField>
          <FormField id="r-phone" label="Contact phone" errors={m.fieldErrors.phone}>
            {(a) => (
              <Input
                {...a}
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            )}
          </FormField>
          <div className="flex items-center gap-2">
            <Switch
              id="r-veg"
              checked={form.isPureVeg}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isPureVeg: v }))}
            />
            <Label htmlFor="r-veg">Pure veg restaurant</Label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-restaurant" disabled={m.isPending}>
            {m.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RestaurantsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('ALL');
  const [cityId, setCityId] = useState('ALL');
  const cities = useCities();
  const filters = {
    status: status === 'ALL' ? undefined : status,
    cityId: cityId === 'ALL' ? undefined : cityId,
  };
  return (
    <>
      <PageHeader
        title="Restaurants"
        description="Onboard restaurants, check their documents and bank details, and manage their branches and menus."
        actions={
          can('restaurants.manage') ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Add restaurant
            </Button>
          ) : null
        }
      />
      <ResourceTable
        queryKey={['restaurants']}
        fetchPage={(p) => api.get('/v1/admin/restaurants', p)}
        columns={columns}
        filters={filters}
        searchPlaceholder="Search by name, slug or cuisine"
        toolbar={
          <div className="flex gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger className="w-36" aria-label="Filter by city">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All cities</SelectItem>
                {(cities.data?.items ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        onRowClick={(r) => router.push(`/restaurants/${r.id}`)}
        rowLabel={(r) => `Open ${r.name}`}
        empty={
          <EmptyState
            icon={Building2}
            title="No restaurants match"
            description="Change the filters, or add the first restaurant."
          />
        }
      />
      <CreateRestaurantDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
