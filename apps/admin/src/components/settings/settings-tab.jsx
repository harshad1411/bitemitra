'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState, ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { ValueEditor, renderValue } from './value-editor';

function sourceLabel(item) {
  if (item.source.scope === 'DEFAULT') return <StatusBadge>Using default</StatusBadge>;
  if (item.override) return <StatusBadge tone="accent">Custom override</StatusBadge>;
  return (
    <StatusBadge tone="info">
      Inherited from {item.source.scope === 'GLOBAL' ? 'global' : item.source.scope.toLowerCase()}
    </StatusBadge>
  );
}

function EditDialog({ item, scope, scopeRefId, onClose }) {
  const [value, setValue] = useState(item.effectiveValue);
  const [reason, setReason] = useState('');
  const m = useApiMutation({
    mutationFn: () =>
      api.put('/v1/admin/settings', {
        key: item.key,
        scope,
        scopeRefId: scopeRefId ?? null,
        value,
        reason: reason.trim() || undefined,
      }),
    invalidate: [['settings'], ['settings-history']],
    success: `${item.label} saved`,
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item.label}</DialogTitle>
          <DialogDescription>
            {item.description}{' '}
            {scope === 'GLOBAL'
              ? 'Applies everywhere unless overridden.'
              : `Override for this ${scope.toLowerCase()} only.`}
          </DialogDescription>
        </DialogHeader>
        {!item.activeNow ? (
          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            Stored now, but nothing reads this setting until Phase {item.phase} — changing it has no effect
            yet.
          </p>
        ) : null}
        {item.legalReview ? (
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            Needs legal/CA confirmation before production (DECISIONS).
          </p>
        ) : null}
        <form id="setting-form" className="grid gap-4" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <ValueEditor value={value} onChange={setValue} fieldErrors={m.fieldErrors} />
          <div className="grid gap-1">
            <Label htmlFor="setting-reason">Reason {item.critical ? '(required)' : '(optional)'}</Label>
            <Textarea
              id="setting-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {m.fieldErrors.reason ? (
              <p className="text-xs text-destructive">{m.fieldErrors.reason.join(' ')}</p>
            ) : null}
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="setting-form"
            disabled={m.isPending || (item.critical && reason.trim().length < 3)}
          >
            {m.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopePicker({ scope, scopeRefId, onChange }) {
  const cities = useQuery({
    queryKey: ['cities', 'all-for-scope'],
    queryFn: () => api.get('/v1/admin/geo/cities', { limit: 100 }),
  });
  const cityId =
    scope === 'CITY'
      ? scopeRefId
      : scope === 'ZONE'
        ? cities.data?.items.find((c) => c.zones?.some((z) => z.id === scopeRefId))?.id
        : null;
  const [selectedCity, setSelectedCity] = useState(cityId ?? null);
  const city = useQuery({
    queryKey: ['city', selectedCity],
    queryFn: () => api.get(`/v1/admin/geo/cities/${selectedCity}`),
    enabled: Boolean(selectedCity),
  });
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Select
        value={scope === 'GLOBAL' ? 'GLOBAL' : (selectedCity ?? '')}
        onValueChange={(v) => {
          if (v === 'GLOBAL') {
            setSelectedCity(null);
            onChange('GLOBAL', null);
          } else {
            setSelectedCity(v);
            onChange('CITY', v);
          }
        }}
      >
        <SelectTrigger className="sm:w-56" aria-label="Scope">
          <SelectValue placeholder="Scope" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="GLOBAL">Global (all cities)</SelectItem>
          {(cities.data?.items ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              City: {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedCity ? (
        <Select
          value={scope === 'ZONE' ? scopeRefId : 'CITY'}
          onValueChange={(v) => (v === 'CITY' ? onChange('CITY', selectedCity) : onChange('ZONE', v))}
        >
          <SelectTrigger className="sm:w-56" aria-label="Zone">
            <SelectValue placeholder="Whole city" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CITY">Whole city</SelectItem>
            {(city.data?.zones ?? []).map((z) => (
              <SelectItem key={z.id} value={z.id}>
                Zone: {z.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

export function SettingsTab({ scope, scopeRefId, onScopeChange }) {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const q = useQuery({
    queryKey: ['settings', scope, scopeRefId],
    queryFn: () => api.get('/v1/admin/settings', { scope, scopeRefId: scopeRefId ?? undefined }),
  });
  const reset = useApiMutation({
    mutationFn: ({ item, reason }) =>
      api.delete('/v1/admin/settings', {
        body: { key: item.key, scope, scopeRefId: scopeRefId ?? null, reason: reason || undefined },
      }),
    invalidate: [['settings'], ['settings-history']],
    success: 'Reset to inherited value',
    onSuccess: () => setResetting(null),
  });

  const sections = useMemo(() => {
    const term = search.trim().toLowerCase();
    const items = (q.data?.items ?? []).filter(
      (i) => !term || `${i.label} ${i.key} ${i.description} ${i.section}`.toLowerCase().includes(term),
    );
    return items.reduce((acc, i) => ((acc[i.section] ??= []).push(i), acc), {});
  }, [q.data, search]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <ScopePicker scope={scope} scopeRefId={scopeRefId} onChange={onScopeChange} />
        <div className="relative lg:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-8"
            placeholder="Search settings"
            aria-label="Search settings"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {q.isPending ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !Object.keys(sections).length ? (
        <EmptyState title="No settings match" />
      ) : (
        Object.entries(sections).map(([section, items]) => (
          <Card key={section} className="gap-0 py-0">
            <h2 className="border-b px-4 py-3 text-sm font-semibold">{section}</h2>
            <ul className="divide-y">
              {items.map((item) => (
                <li
                  key={item.key}
                  className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {sourceLabel(item)}
                      {!item.activeNow ? <StatusBadge>Takes effect in Phase {item.phase}</StatusBadge> : null}
                      {item.placeholder ? <StatusBadge tone="warning">Placeholder amount</StatusBadge> : null}
                      {item.legalReview ? <StatusBadge tone="critical">Legal review</StatusBadge> : null}
                      {item.critical ? (
                        <StatusBadge tone="accent">Audited · reason required</StatusBadge>
                      ) : null}
                    </div>
                  </div>
                  <div className="min-w-0">{renderValue(item.effectiveValue)}</div>
                  <div className="flex items-start gap-2">
                    {can('config.manage') && item.overridableHere ? (
                      <Button variant="outline" size="sm" onClick={() => setEditing(item)}>
                        {scope === 'GLOBAL' || item.override ? 'Edit' : 'Override'}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {item.overridableHere ? '' : `Not overridable per ${scope.toLowerCase()}`}
                      </span>
                    )}
                    {can('config.manage') && item.override ? (
                      <Button variant="ghost" size="sm" onClick={() => setResetting(item)}>
                        Reset
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
      {editing ? (
        <EditDialog item={editing} scope={scope} scopeRefId={scopeRefId} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={Boolean(resetting)}
        onOpenChange={(o) => !o && setResetting(null)}
        title={`Reset ${resetting?.label ?? ''}?`}
        description={
          scope === 'GLOBAL'
            ? 'The built-in default will apply everywhere without an override.'
            : 'This scope will inherit the value from its parent again. History is kept.'
        }
        confirmLabel="Reset"
        requireReason={resetting?.critical}
        busy={reset.isPending}
        onConfirm={(reason) => reset.mutate({ item: resetting, reason })}
      />
    </div>
  );
}
