'use client';

import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';

/** Role grants, each optionally limited to a city (City Manager must be). */
export function GrantsEditor({ grants, onChange, errors }) {
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/v1/admin/roles') });
  const cities = useQuery({
    queryKey: ['cities', 'all-for-grants'],
    queryFn: () => api.get('/v1/admin/geo/cities', { limit: 100 }),
  });
  const roleById = new Map((roles.data?.items ?? []).map((r) => [r.id, r]));
  const update = (i, patch) => onChange(grants.map((g, j) => (i === j ? { ...g, ...patch } : g)));
  return (
    <div className="grid gap-2">
      {grants.map((g, i) => (
        <div key={i} className="flex flex-col gap-2 sm:flex-row">
          <Select
            value={g.roleId}
            onValueChange={(v) =>
              update(i, { roleId: v, cityId: roleById.get(v)?.cityScoped ? g.cityId : null })
            }
          >
            <SelectTrigger className="sm:flex-1" aria-label={`Role ${i + 1}`}>
              <SelectValue placeholder="Choose a role" />
            </SelectTrigger>
            <SelectContent>
              {(roles.data?.items ?? []).map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={g.cityId ?? 'ALL'}
            onValueChange={(v) => update(i, { cityId: v === 'ALL' ? null : v })}
          >
            <SelectTrigger className="sm:w-48" aria-label={`City limit for role ${i + 1}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!roleById.get(g.roleId)?.cityScoped ? <SelectItem value="ALL">All cities</SelectItem> : null}
              {(cities.data?.items ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  Only {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove role"
            onClick={() => onChange(grants.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => onChange([...grants, { roleId: '', cityId: null }])}
      >
        <Plus /> Add role
      </Button>
      {errors?.length ? <p className="text-xs text-destructive">{errors.join(' ')}</p> : null}
    </div>
  );
}
