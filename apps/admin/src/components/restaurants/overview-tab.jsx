'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleDashed, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/jamzo/form-field';
import { MediaPicker } from '@/components/jamzo/media-picker';
import { api, apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';

const LEVEL_LABEL = { submit: 'Before review', approve: 'Before approval', live: 'Before going live' };

/** The exact checklist the API enforces for each onboarding step (D-34). */
function Readiness({ checks }) {
  const levels = ['submit', 'approve', 'live'];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Onboarding checklist</CardTitle>
        <CardDescription>
          Checked by the server on every status change — this list is what it enforces.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        {levels.map((level) => (
          <div key={level}>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {LEVEL_LABEL[level]}
            </p>
            <ul className="grid gap-2" aria-label={LEVEL_LABEL[level]}>
              {checks
                .filter((c) => c.level === level)
                .map((c) => (
                  <li key={c.key} className="flex gap-2 text-sm">
                    {c.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />
                    ) : (
                      <CircleDashed
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-label="Not done"
                      />
                    )}
                    <span>
                      {c.label}
                      {!c.ok && c.detail ? (
                        <span className="block text-xs text-muted-foreground">{c.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ImageField({ label, mediaId, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const media = useQuery({
    queryKey: ['media', mediaId],
    queryFn: () => api.get(`/v1/admin/media/${mediaId}`),
    enabled: Boolean(mediaId),
  });
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex size-16 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {media.data ? (
            <img
              src={apiUrl(media.data.urls.thumb ?? media.data.urls.original)}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        {!disabled ? (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              {mediaId ? 'Change' : 'Choose'}
            </Button>
            {mediaId ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {open ? <MediaPicker open onOpenChange={setOpen} onSelect={(m) => m && onChange(m.id)} /> : null}
    </div>
  );
}

export function OverviewTab({ restaurant: r }) {
  const { can } = useAuth();
  const editable = can('restaurants.manage');
  const initial = {
    name: r.name,
    slug: r.slug,
    legalName: r.legalName ?? '',
    description: r.description ?? '',
    cuisines: r.cuisines.join(', '),
    phone: r.phone ?? '',
    email: r.email ?? '',
    gstin: r.gstin ?? '',
    pan: r.pan ?? '',
    fssaiNumber: r.fssaiNumber ?? '',
    fssaiExpiresOn: r.fssaiExpiresOn ?? '',
    isPureVeg: r.isPureVeg,
    isPromoted: r.isPromoted,
    logoMediaId: r.logoMediaId,
    coverMediaId: r.coverMediaId,
  };
  const [form, setForm] = useState(initial);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const blank = (v) => (v.trim() === '' ? null : v.trim());
  const save = useApiMutation({
    mutationFn: () =>
      api.patch(`/v1/admin/restaurants/${r.id}`, {
        name: form.name,
        slug: form.slug,
        legalName: blank(form.legalName),
        description: blank(form.description),
        cuisines: form.cuisines
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        phone: blank(form.phone),
        email: blank(form.email),
        gstin: blank(form.gstin),
        pan: blank(form.pan),
        fssaiNumber: blank(form.fssaiNumber),
        fssaiExpiresOn: blank(form.fssaiExpiresOn),
        isPureVeg: form.isPureVeg,
        isPromoted: form.isPromoted,
        logoMediaId: form.logoMediaId,
        coverMediaId: form.coverMediaId,
      }),
    invalidate: [['restaurant', r.id], ['restaurants']],
    success: 'Restaurant saved',
  });
  const e = save.fieldErrors;
  const text = (k, label, props = {}) => (
    <FormField id={`o-${k}`} label={label} errors={e[k]} help={props.help}>
      {(a) => (
        <Input {...a} value={form[k]} onChange={set(k)} disabled={!editable} {...props} help={undefined} />
      )}
    </FormField>
  );

  return (
    <div className="grid gap-4">
      <Readiness checks={r.readiness} />
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            What customers see, and the legal details used for approval and invoices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            id="restaurant-profile"
            className="grid gap-4 lg:grid-cols-2"
            onSubmit={(ev) => (ev.preventDefault(), save.mutate())}
          >
            {text('name', 'Name')}
            {text('slug', 'Slug')}
            {text('legalName', 'Legal name')}
            {text('cuisines', 'Cuisines', { help: 'Comma separated' })}
            <div className="lg:col-span-2">
              <FormField id="o-description" label="Description" errors={e.description}>
                {(a) => (
                  <Textarea
                    {...a}
                    rows={3}
                    value={form.description}
                    onChange={set('description')}
                    disabled={!editable}
                  />
                )}
              </FormField>
            </div>
            {text('phone', 'Contact phone', { inputMode: 'tel' })}
            {text('email', 'Contact email', { type: 'email' })}
            {text('gstin', 'GSTIN', { help: 'Only if the restaurant is GST registered' })}
            {text('pan', 'PAN')}
            {text('fssaiNumber', 'FSSAI number')}
            {text('fssaiExpiresOn', 'FSSAI valid until', { type: 'date' })}
            <ImageField
              label="Logo"
              mediaId={form.logoMediaId}
              onChange={set('logoMediaId')}
              disabled={!editable}
            />
            <ImageField
              label="Cover image"
              mediaId={form.coverMediaId}
              onChange={set('coverMediaId')}
              disabled={!editable}
            />
            <div className="flex items-center gap-2">
              <Switch
                id="o-veg"
                checked={form.isPureVeg}
                onCheckedChange={set('isPureVeg')}
                disabled={!editable}
              />
              <Label htmlFor="o-veg">Pure veg</Label>
              {e.isPureVeg ? <span className="text-xs text-destructive">{e.isPureVeg.join(' ')}</span> : null}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="o-promoted"
                checked={form.isPromoted}
                onCheckedChange={set('isPromoted')}
                disabled={!editable}
              />
              <Label htmlFor="o-promoted">Promoted (shown as “Promoted” in listings from Phase 3)</Label>
            </div>
          </form>
          {editable ? (
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(initial)} disabled={save.isPending}>
                Discard changes
              </Button>
              <Button type="submit" form="restaurant-profile" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
