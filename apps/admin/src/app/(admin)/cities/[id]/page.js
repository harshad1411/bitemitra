'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState, ErrorState, LoadingRows } from '@/components/jamzo/states';
import { FormField } from '@/components/jamzo/form-field';
import { GeometryPreview } from '@/components/jamzo/geometry-preview';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { slugify } from '@/lib/format';

const EXAMPLE_POLYGON = JSON.stringify(
  {
    type: 'Polygon',
    coordinates: [
      [
        [72.38, 23.795],
        [72.405, 23.795],
        [72.405, 23.815],
        [72.38, 23.815],
        [72.38, 23.795],
      ],
    ],
  },
  null,
  2,
);

function parseGeometry(text) {
  try {
    const g = JSON.parse(text);
    return g && (g.type === 'Polygon' || g.type === 'MultiPolygon')
      ? { ok: true, value: g }
      : { ok: false, error: 'Paste a GeoJSON Polygon or MultiPolygon.' };
  } catch {
    return { ok: false, error: 'Not valid JSON.' };
  }
}

function ZoneDialog({ cityId, zone, open, onOpenChange }) {
  const [name, setName] = useState(zone?.name ?? '');
  const [slug, setSlug] = useState(zone?.slug ?? '');
  const [text, setText] = useState(zone ? JSON.stringify(zone.geometry, null, 2) : EXAMPLE_POLYGON);
  const geo = parseGeometry(text);
  const m = useApiMutation({
    mutationFn: () =>
      zone
        ? api.patch(`/v1/admin/geo/zones/${zone.id}`, { name, slug, geometry: geo.value })
        : api.post('/v1/admin/geo/zones', { cityId, name, slug, geometry: geo.value }),
    invalidate: [['city', cityId], ['cities']],
    success: zone ? 'Zone updated' : 'Zone created',
    onSuccess: () => onOpenChange(false),
  });
  const geomErrors = Object.entries(m.fieldErrors)
    .filter(([k]) => k.startsWith('geometry'))
    .map(([k, v]) => `${k}: ${v.join(' ')}`);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{zone ? `Edit ${zone.name}` : 'Add a zone'}</DialogTitle>
          <DialogDescription>
            Paste the zone boundary as GeoJSON ([longitude, latitude] order; the ring must be closed). A
            map-based editor needs the maps provider decision (Q-14).
          </DialogDescription>
        </DialogHeader>
        <form
          id="zone-form"
          className="grid gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={(e) => (e.preventDefault(), geo.ok && m.mutate())}
        >
          <div className="grid gap-3">
            <FormField id="zone-name" label="Name" errors={m.fieldErrors.name}>
              {(a) => (
                <Input
                  {...a}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!zone) setSlug(slugify(e.target.value));
                  }}
                />
              )}
            </FormField>
            <FormField id="zone-slug" label="Slug" errors={m.fieldErrors.slug}>
              {(a) => <Input {...a} value={slug} onChange={(e) => setSlug(e.target.value)} />}
            </FormField>
            <FormField
              id="zone-geometry"
              label="Boundary (GeoJSON)"
              errors={[...(geo.ok ? [] : [geo.error]), ...geomErrors]}
            >
              {(a) => (
                <Textarea
                  {...a}
                  className="font-mono text-xs"
                  rows={10}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </FormField>
          </div>
          <div className="grid content-start gap-1 text-xs text-muted-foreground">
            <GeometryPreview geometry={geo.ok ? geo.value : null} />
            Preview
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="zone-form" disabled={!geo.ok || m.isPending}>
            {m.isPending ? 'Saving…' : 'Save zone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AreaDialog({ cityId, zone, open, onOpenChange }) {
  const [form, setForm] = useState({ name: '', centerLat: '', centerLng: '', radiusM: '2000' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const m = useApiMutation({
    mutationFn: () =>
      api.post('/v1/admin/geo/service-areas', {
        zoneId: zone.id,
        name: form.name,
        kind: 'RADIUS',
        centerLat: Number(form.centerLat),
        centerLng: Number(form.centerLng),
        radiusM: Number(form.radiusM),
      }),
    invalidate: [['city', cityId]],
    success: 'Service area added',
    onSuccess: () => onOpenChange(false),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a service area to {zone?.name}</DialogTitle>
          <DialogDescription>
            Once a zone has service areas, only addresses inside at least one of them are serviceable.
          </DialogDescription>
        </DialogHeader>
        <form id="area-form" className="grid gap-3" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <FormField id="area-name" label="Name" errors={m.fieldErrors.name}>
            {(a) => <Input {...a} value={form.name} onChange={set('name')} />}
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="area-lat" label="Centre latitude" errors={m.fieldErrors.centerLat}>
              {(a) => <Input {...a} inputMode="decimal" value={form.centerLat} onChange={set('centerLat')} />}
            </FormField>
            <FormField id="area-lng" label="Centre longitude" errors={m.fieldErrors.centerLng}>
              {(a) => <Input {...a} inputMode="decimal" value={form.centerLng} onChange={set('centerLng')} />}
            </FormField>
          </div>
          <FormField id="area-radius" label="Radius (metres)" errors={m.fieldErrors.radiusM}>
            {(a) => <Input {...a} inputMode="numeric" value={form.radiusM} onChange={set('radiusM')} />}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="area-form" disabled={m.isPending}>
            Add area
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CityPage({ params }) {
  const { id } = use(params);
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['city', id], queryFn: () => api.get(`/v1/admin/geo/cities/${id}`) });
  const [zoneDialog, setZoneDialog] = useState(null); // null | 'new' | zone
  const [areaZone, setAreaZone] = useState(null);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const launch = useApiMutation({
    mutationFn: (reason) => api.patch(`/v1/admin/geo/cities/${id}`, { isActive: !q.data.isActive, reason }),
    invalidate: [['city', id], ['cities'], ['dashboard']],
    success: (c) => (c.isActive ? `${c.name} is live` : `${c.name} is paused`),
    onSuccess: () => setConfirmLaunch(false),
  });
  const toggleArea = useApiMutation({
    mutationFn: ({ areaId, isActive }) => api.patch(`/v1/admin/geo/service-areas/${areaId}`, { isActive }),
    invalidate: [['city', id]],
    success: 'Service area updated',
  });

  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const city = q.data;
  const manage = can('geo.manage');

  return (
    <>
      <PageHeader
        back={{ href: '/cities', label: 'Cities' }}
        title={city.name}
        description={`${city.state.name}, ${city.state.country.name} · ${city.timezone} · centre ${city.centerLat}, ${city.centerLng}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/settings?scope=CITY&scopeRefId=${city.id}`}>
                <Settings2 /> City configuration
              </Link>
            </Button>
            {manage ? (
              <Button variant={city.isActive ? 'outline' : 'default'} onClick={() => setConfirmLaunch(true)}>
                {city.isActive ? 'Pause city' : 'Launch city'}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-4">
        {city.isActive ? (
          <StatusBadge tone="success">Live — accepting customers</StatusBadge>
        ) : (
          <StatusBadge>Not launched</StatusBadge>
        )}
      </div>

      <Tabs defaultValue="zones">
        <TabsList>
          <TabsTrigger value="zones">Zones ({city.zones.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="zones" className="mt-4 grid gap-4">
          {manage ? (
            <div>
              <Button onClick={() => setZoneDialog('new')}>
                <Plus /> Add zone
              </Button>
            </div>
          ) : null}
          {!city.zones.length ? (
            <Card>
              <EmptyState
                title="No zones yet"
                description="Zones define where Jamzo operates in this city. Add at least one before launching."
              />
            </Card>
          ) : (
            city.zones.map((z) => (
              <Card key={z.id}>
                <CardHeader className="flex flex-row items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">
                      {z.name} {z.isActive ? null : <StatusBadge className="ml-2">Inactive</StatusBadge>}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">{z.slug}</CardDescription>
                  </div>
                  {manage ? (
                    <Button variant="outline" size="sm" onClick={() => setZoneDialog(z)}>
                      Edit
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-4 sm:flex-row">
                  <GeometryPreview geometry={z.geometry} size={120} label={`${z.name} boundary`} />
                  <div className="flex-1">
                    <p className="mb-2 text-sm font-medium">Service areas</p>
                    {!z.serviceAreas.length ? (
                      <p className="text-sm text-muted-foreground">None — the whole zone is serviceable.</p>
                    ) : (
                      <ul className="divide-y rounded border text-sm">
                        {z.serviceAreas.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span>
                              {a.name}{' '}
                              <span className="text-muted-foreground">
                                {a.kind === 'RADIUS'
                                  ? `· ${a.radiusM} m around ${a.centerLat}, ${a.centerLng}`
                                  : '· polygon'}
                              </span>
                            </span>
                            {manage ? (
                              <Switch
                                checked={a.isActive}
                                aria-label={`${a.name} active`}
                                onCheckedChange={(v) => toggleArea.mutate({ areaId: a.id, isActive: v })}
                              />
                            ) : (
                              <StatusBadge tone={a.isActive ? 'success' : 'neutral'}>
                                {a.isActive ? 'Active' : 'Inactive'}
                              </StatusBadge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {manage ? (
                      <Button variant="link" className="mt-1 h-auto p-0" onClick={() => setAreaZone(z)}>
                        <Plus /> Add radius service area
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {zoneDialog ? (
        <ZoneDialog
          key={zoneDialog === 'new' ? 'new' : zoneDialog.id}
          cityId={id}
          zone={zoneDialog === 'new' ? null : zoneDialog}
          open
          onOpenChange={(o) => !o && setZoneDialog(null)}
        />
      ) : null}
      {areaZone ? (
        <AreaDialog
          key={areaZone.id}
          cityId={id}
          zone={areaZone}
          open
          onOpenChange={(o) => !o && setAreaZone(null)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmLaunch}
        onOpenChange={setConfirmLaunch}
        title={city.isActive ? `Pause ${city.name}?` : `Launch ${city.name}?`}
        description={
          city.isActive
            ? 'Customers in this city will no longer be serviceable.'
            : 'Customers inside active zones become serviceable immediately.'
        }
        confirmLabel={city.isActive ? 'Pause city' : 'Launch city'}
        destructive={city.isActive}
        requireReason
        busy={launch.isPending}
        onConfirm={(reason) => launch.mutate(reason)}
      />
    </>
  );
}
