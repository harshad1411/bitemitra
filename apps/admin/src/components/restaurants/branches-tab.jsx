'use client';

import { useState } from 'react';
import { MapPin, Plus, Trash2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/jamzo/form-field';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { GeometryPreview } from '@/components/jamzo/geometry-preview';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { DAYS, openStateText } from '@/lib/restaurants';

function BranchDialog({ restaurantId, branch, open, onOpenChange }) {
  const [form, setForm] = useState({
    name: branch?.name ?? '',
    addressLine: branch?.addressLine ?? '',
    area: branch?.area ?? '',
    pincode: branch?.pincode ?? '',
    lat: branch?.lat?.toString() ?? '',
    lng: branch?.lng?.toString() ?? '',
    prepTimeMinutes: String(branch?.prepTimeMinutes ?? 20),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const m = useApiMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        addressLine: form.addressLine,
        area: form.area || null,
        pincode: form.pincode || null,
        lat: Number(form.lat),
        lng: Number(form.lng),
        prepTimeMinutes: Number(form.prepTimeMinutes),
      };
      return branch
        ? api.patch(`/v1/admin/branches/${branch.id}`, body)
        : api.post(`/v1/admin/restaurants/${restaurantId}/branches`, body);
    },
    invalidate: [['restaurant', restaurantId]],
    success: branch ? 'Branch saved' : 'Branch added — now set its hours and delivery area',
    onSuccess: () => onOpenChange(false),
  });
  const e = m.fieldErrors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : 'Add a branch'}</DialogTitle>
          <DialogDescription>
            The zone is worked out from the location. A branch outside every zone of the city cannot be
            submitted for review.
          </DialogDescription>
        </DialogHeader>
        <form id="branch-form" className="grid gap-3" onSubmit={(ev) => (ev.preventDefault(), m.mutate())}>
          <FormField id="b-name" label="Branch name" errors={e.name}>
            {(a) => <Input {...a} value={form.name} onChange={set('name')} placeholder="Station Road" />}
          </FormField>
          <FormField id="b-address" label="Address" errors={e.addressLine}>
            {(a) => <Input {...a} value={form.addressLine} onChange={set('addressLine')} />}
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="b-area" label="Area" errors={e.area}>
              {(a) => <Input {...a} value={form.area} onChange={set('area')} />}
            </FormField>
            <FormField id="b-pincode" label="PIN code" errors={e.pincode}>
              {(a) => <Input {...a} inputMode="numeric" value={form.pincode} onChange={set('pincode')} />}
            </FormField>
            <FormField id="b-lat" label="Latitude" errors={e.lat}>
              {(a) => (
                <Input
                  {...a}
                  inputMode="decimal"
                  value={form.lat}
                  onChange={set('lat')}
                  placeholder="23.8045"
                />
              )}
            </FormField>
            <FormField id="b-lng" label="Longitude" errors={e.lng}>
              {(a) => (
                <Input
                  {...a}
                  inputMode="decimal"
                  value={form.lng}
                  onChange={set('lng')}
                  placeholder="72.3925"
                />
              )}
            </FormField>
          </div>
          <FormField id="b-prep" label="Preparation time (minutes)" errors={e.prepTimeMinutes}>
            {(a) => (
              <Input
                {...a}
                inputMode="numeric"
                value={form.prepTimeMinutes}
                onChange={set('prepTimeMinutes')}
              />
            )}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="branch-form" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Save branch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Weekly hours: several intervals per day; closing may be after midnight or 24:00 (validated by the API). */
function HoursEditor({ restaurantId, branch, editable }) {
  const [rows, setRows] = useState(
    branch.hours.map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt })),
  );
  const m = useApiMutation({
    mutationFn: () => api.put(`/v1/admin/branches/${branch.id}/hours`, { hours: rows }),
    invalidate: [['restaurant', restaurantId]],
    success: 'Opening hours saved',
  });
  const update = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const errorsFor = (i) =>
    Object.entries(m.fieldErrors)
      .filter(([k]) => k.startsWith(`hours.${i}.`))
      .flatMap(([, v]) => v);
  const copyToAll = (day) => {
    const src = rows.filter((r) => r.dayOfWeek === day);
    setRows([0, 1, 2, 3, 4, 5, 6].flatMap((d) => src.map((r) => ({ ...r, dayOfWeek: d }))));
  };
  return (
    <div className="grid gap-2">
      {DAYS.map((dayName, day) => {
        const indexed = rows.map((r, i) => ({ ...r, i })).filter((r) => r.dayOfWeek === day);
        return (
          <div key={day} className="grid gap-1 border-b pb-2 last:border-0 sm:grid-cols-[7rem_1fr]">
            <p className="pt-1.5 text-sm font-medium">{dayName}</p>
            <div className="grid gap-1.5">
              {!indexed.length ? <p className="pt-1.5 text-sm text-muted-foreground">Closed</p> : null}
              {indexed.map((r) => (
                <div key={r.i}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`${dayName} opens`}
                      className="w-32"
                      value={r.opensAt}
                      disabled={!editable}
                      onChange={(e) => update(r.i, { opensAt: e.target.value })}
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      aria-label={`${dayName} closes`}
                      className="w-24"
                      value={r.closesAt}
                      disabled={!editable}
                      onChange={(e) => update(r.i, { closesAt: e.target.value })}
                      placeholder="23:00"
                    />
                    {editable ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${dayName} ${r.opensAt}–${r.closesAt}`}
                        onClick={() => setRows((rs) => rs.filter((_, j) => j !== r.i))}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </div>
                  {errorsFor(r.i).length ? (
                    <p className="text-xs text-destructive">{errorsFor(r.i).join(' ')}</p>
                  ) : null}
                </div>
              ))}
              {editable ? (
                <div className="flex gap-2">
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() =>
                      setRows((rs) => [...rs, { dayOfWeek: day, opensAt: '11:00', closesAt: '23:00' }])
                    }
                  >
                    <Plus /> Add hours
                  </Button>
                  {indexed.length ? (
                    <Button variant="link" size="sm" className="h-auto px-0" onClick={() => copyToAll(day)}>
                      Copy to every day
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Closing time is 24-hour “HH:mm”. A closing time earlier than the opening time runs past midnight (e.g.
        17:00 to 01:00); 24:00 means end of day.
      </p>
      {editable ? (
        <div className="flex justify-end">
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Save hours'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DeliveryAreaEditor({ restaurantId, branch, editable }) {
  const area = branch.deliveryArea;
  const [kind, setKind] = useState(area?.kind ?? 'RADIUS');
  const [radius, setRadius] = useState(String(area?.radiusM ?? 4000));
  const [text, setText] = useState(area?.geometry ? JSON.stringify(area.geometry, null, 2) : '');
  let geometry = null;
  try {
    geometry = text ? JSON.parse(text) : null;
  } catch {
    geometry = null;
  }
  const m = useApiMutation({
    mutationFn: () =>
      api.put(
        `/v1/admin/branches/${branch.id}/delivery-area`,
        kind === 'RADIUS' ? { kind, radiusM: Number(radius) } : { kind, geometry },
      ),
    invalidate: [['restaurant', restaurantId]],
    success: 'Delivery area saved',
  });
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Customers must be inside a zone’s service area <em>and</em> inside this area to order from the branch
        (from Phase 3).
        {area ? '' : ' No delivery area yet.'}
      </p>
      <div className="flex gap-2" role="radiogroup" aria-label="Delivery area type">
        {['RADIUS', 'POLYGON'].map((k) => (
          <Button
            key={k}
            variant={kind === k ? 'default' : 'outline'}
            size="sm"
            role="radio"
            aria-checked={kind === k}
            disabled={!editable}
            onClick={() => setKind(k)}
          >
            {k === 'RADIUS' ? 'Radius' : 'Polygon'}
          </Button>
        ))}
      </div>
      {kind === 'RADIUS' ? (
        <FormField
          id={`radius-${branch.id}`}
          label="Radius (metres)"
          errors={m.fieldErrors.radiusM}
          help="Straight-line distance from the branch; 100 m to 50 km."
        >
          {(a) => (
            <Input
              {...a}
              className="w-40"
              inputMode="numeric"
              value={radius}
              disabled={!editable}
              onChange={(e) => setRadius(e.target.value)}
            />
          )}
        </FormField>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <FormField
            id={`polygon-${branch.id}`}
            label="Area (GeoJSON Polygon, [longitude, latitude])"
            errors={Object.entries(m.fieldErrors)
              .filter(([k]) => k.startsWith('geometry'))
              .flatMap(([k, v]) => v.map((x) => `${k}: ${x}`))}
          >
            {(a) => (
              <Textarea
                {...a}
                rows={6}
                className="font-mono text-xs"
                value={text}
                disabled={!editable}
                onChange={(e) => setText(e.target.value)}
              />
            )}
          </FormField>
          <GeometryPreview geometry={geometry} />
        </div>
      )}
      {editable ? (
        <div className="flex justify-end">
          <Button onClick={() => m.mutate()} disabled={m.isPending || (kind === 'POLYGON' && !geometry)}>
            {m.isPending ? 'Saving…' : 'Save delivery area'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StatusControls({ restaurant, branch, editable }) {
  const [prep, setPrep] = useState(String(branch.prepTimeMinutes));
  const m = useApiMutation({
    mutationFn: (body) => api.patch(`/v1/admin/branches/${branch.id}`, body),
    invalidate: [['restaurant', restaurant.id]],
    success: 'Branch updated',
  });
  const paused = branch.pausedUntil && new Date(branch.pausedUntil) > new Date();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="flex items-center gap-2">
        <Switch
          id={`open-${branch.id}`}
          checked={branch.isOpen}
          disabled={!editable || m.isPending}
          onCheckedChange={(v) => m.mutate({ isOpen: v })}
        />
        <Label htmlFor={`open-${branch.id}`}>Accepting orders</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`busy-${branch.id}`}
          checked={branch.busyMode}
          disabled={!editable || m.isPending}
          onCheckedChange={(v) => m.mutate({ busyMode: v })}
        />
        <Label htmlFor={`busy-${branch.id}`}>Busy mode (longer preparation)</Label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {paused ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!editable || m.isPending}
            onClick={() => m.mutate({ pauseMinutes: 0 })}
          >
            Resume now
          </Button>
        ) : (
          [15, 30, 60].map((n) => (
            <Button
              key={n}
              size="sm"
              variant="outline"
              disabled={!editable || m.isPending}
              onClick={() => m.mutate({ pauseMinutes: n })}
            >
              Pause {n} min
            </Button>
          ))
        )}
      </div>
      <div className="flex items-end gap-2 sm:col-span-3">
        <FormField
          id={`prep-${branch.id}`}
          label="Preparation time (minutes)"
          errors={m.fieldErrors.prepTimeMinutes}
        >
          {(a) => (
            <Input
              {...a}
              className="w-24"
              inputMode="numeric"
              value={prep}
              disabled={!editable}
              onChange={(e) => setPrep(e.target.value)}
            />
          )}
        </FormField>
        {editable ? (
          <Button
            size="sm"
            variant="outline"
            disabled={m.isPending || prep === String(branch.prepTimeMinutes)}
            onClick={() => m.mutate({ prepTimeMinutes: Number(prep) })}
          >
            Save
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function BranchesTab({ restaurant }) {
  const { can } = useAuth();
  const editable = can('restaurants.manage');
  const [dialog, setDialog] = useState(null); // 'new' | branch
  const zoneName = (id) => restaurant.zones.find((z) => z.id === id)?.name;
  return (
    <div className="grid gap-4">
      {editable ? (
        <div className="flex justify-end">
          <Button onClick={() => setDialog('new')}>
            <Plus /> Add branch
          </Button>
        </div>
      ) : null}
      {!restaurant.branches.length ? (
        <Card>
          <EmptyState
            icon={MapPin}
            title="No branch yet"
            description="Add the restaurant’s kitchen location to set its hours and delivery area."
          />
        </Card>
      ) : null}
      {restaurant.branches.map((b) => {
        const st = openStateText(b.openState, restaurant.city.timezone);
        return (
          <Card key={b.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {b.name}
                  {b.isPrimary ? <StatusBadge>Primary</StatusBadge> : null}
                  <StatusBadge tone={st.tone}>{st.text}</StatusBadge>
                </CardTitle>
                <CardDescription>
                  {b.addressLine}
                  {b.pincode ? ` · ${b.pincode}` : ''} · {b.lat}, {b.lng} ·{' '}
                  {b.zoneId ? (
                    `Zone: ${zoneName(b.zoneId) ?? 'assigned'}`
                  ) : (
                    <span className="text-destructive">outside every zone</span>
                  )}
                </CardDescription>
              </div>
              {editable ? (
                <Button variant="outline" size="sm" onClick={() => setDialog(b)}>
                  Edit details
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-6">
              <section aria-label="Live status">
                <h3 className="mb-2 text-sm font-semibold">Live status</h3>
                <StatusControls restaurant={restaurant} branch={b} editable={editable} />
              </section>
              <section aria-label="Opening hours">
                <h3 className="mb-2 text-sm font-semibold">Opening hours ({restaurant.city.timezone})</h3>
                <HoursEditor
                  key={JSON.stringify(b.hours)}
                  restaurantId={restaurant.id}
                  branch={b}
                  editable={editable}
                />
              </section>
              <section aria-label="Delivery area">
                <h3 className="mb-2 text-sm font-semibold">Delivery area</h3>
                <DeliveryAreaEditor
                  key={b.deliveryArea?.id ?? 'none'}
                  restaurantId={restaurant.id}
                  branch={b}
                  editable={editable}
                />
              </section>
            </CardContent>
          </Card>
        );
      })}
      {dialog ? (
        <BranchDialog
          restaurantId={restaurant.id}
          branch={dialog === 'new' ? null : dialog}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      ) : null}
    </div>
  );
}
