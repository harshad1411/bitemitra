'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MapPinned, Plus } from 'lucide-react';
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
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { FormField } from '@/components/jamzo/form-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { slugify } from '@/lib/format';

const columns = [
  {
    header: 'City',
    accessorKey: 'name',
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  { header: 'State', cell: ({ row }) => `${row.original.state.name}, ${row.original.state.country.code}` },
  { header: 'Zones', cell: ({ row }) => <span className="tabular-nums">{row.original._count.zones}</span> },
  { header: 'Timezone', accessorKey: 'timezone' },
  {
    header: 'Status',
    cell: ({ row }) =>
      row.original.isActive ? (
        <StatusBadge tone="success">Live</StatusBadge>
      ) : (
        <StatusBadge>Not launched</StatusBadge>
      ),
  },
];

function CreateCityDialog({ open, onOpenChange }) {
  const router = useRouter();
  const countries = useQuery({
    queryKey: ['countries'],
    queryFn: () => api.get('/v1/admin/geo/countries'),
    enabled: open,
  });
  const states = (countries.data?.items ?? []).flatMap((c) => c.states.map((s) => ({ ...s, country: c })));
  const [form, setForm] = useState({
    stateId: '',
    name: '',
    slug: '',
    centerLat: '',
    centerLng: '',
    timezone: 'Asia/Kolkata',
  });
  const set = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.value,
      ...(k === 'name' && !f.slugTouched ? { slug: slugify(e.target.value) } : {}),
    }));
  const m = useApiMutation({
    mutationFn: () =>
      api.post('/v1/admin/geo/cities', {
        ...form,
        slugTouched: undefined,
        centerLat: Number(form.centerLat),
        centerLng: Number(form.centerLng),
      }),
    invalidate: [['cities'], ['dashboard']],
    success: (c) => `${c.name} created (not launched yet)`,
    onSuccess: (c) => router.push(`/cities/${c.id}`),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a city</DialogTitle>
          <DialogDescription>
            New cities start “not launched”. Add zones and configuration, then launch.
          </DialogDescription>
        </DialogHeader>
        <form id="create-city" className="grid gap-3" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <FormField id="stateId" label="State" errors={m.fieldErrors.stateId}>
            <Select value={form.stateId} onValueChange={(v) => setForm((f) => ({ ...f, stateId: v }))}>
              <SelectTrigger id="stateId" className="w-full">
                <SelectValue placeholder={countries.isPending ? 'Loading…' : 'Choose a state'} />
              </SelectTrigger>
              <SelectContent>
                {states.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}, {s.country.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="name" label="Name" errors={m.fieldErrors.name}>
            {(a) => <Input {...a} value={form.name} onChange={set('name')} placeholder="Mehsana" />}
          </FormField>
          <FormField
            id="slug"
            label="Slug"
            help="Used in URLs; lowercase letters, numbers and hyphens."
            errors={m.fieldErrors.slug}
          >
            {(a) => (
              <Input
                {...a}
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value, slugTouched: true }))}
              />
            )}
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="centerLat" label="Centre latitude" errors={m.fieldErrors.centerLat}>
              {(a) => (
                <Input
                  {...a}
                  inputMode="decimal"
                  value={form.centerLat}
                  onChange={set('centerLat')}
                  placeholder="23.5880"
                />
              )}
            </FormField>
            <FormField id="centerLng" label="Centre longitude" errors={m.fieldErrors.centerLng}>
              {(a) => (
                <Input
                  {...a}
                  inputMode="decimal"
                  value={form.centerLng}
                  onChange={set('centerLng')}
                  placeholder="72.3693"
                />
              )}
            </FormField>
          </div>
          <FormField id="timezone" label="Timezone" errors={m.fieldErrors.timezone}>
            {(a) => <Input {...a} value={form.timezone} onChange={set('timezone')} />}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-city" disabled={m.isPending}>
            {m.isPending ? 'Creating…' : 'Create city'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CitiesPage() {
  const router = useRouter();
  const { me, can } = useAuth();
  const [open, setOpen] = useState(false);
  // City Managers (every grant limited to a city) cannot create cities; the API enforces this too.
  const cityScoped = (me?.admin?.roles ?? []).every((r) => r.cityId);
  return (
    <>
      <PageHeader
        title="Cities & zones"
        description="Every city is data, not code: add a city, draw its zones and service areas, configure it, then launch."
        actions={
          can('geo.manage') && !cityScoped ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Add city
            </Button>
          ) : null
        }
      />
      <ResourceTable
        queryKey={['cities']}
        fetchPage={(p) => api.get('/v1/admin/geo/cities', p)}
        columns={columns}
        searchPlaceholder="Search cities"
        onRowClick={(c) => router.push(`/cities/${c.id}`)}
        rowLabel={(c) => `Open ${c.name}`}
        empty={
          <EmptyState
            icon={MapPinned}
            title="No cities yet"
            description="Add the first launch city to start configuring zones."
          />
        }
      />
      <CreateCityDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
