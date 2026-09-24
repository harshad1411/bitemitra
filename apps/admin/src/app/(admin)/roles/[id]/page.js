'use client';

import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';

export default function RolePage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const { can, me } = useAuth();
  const role = useQuery({ queryKey: ['roles', id], queryFn: () => api.get(`/v1/admin/roles/${id}`) });
  const catalogue = useQuery({ queryKey: ['permissions'], queryFn: () => api.get('/v1/admin/permissions') });
  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'save' | 'delete'
  const save = useApiMutation({
    mutationFn: ({ reason }) => api.patch(`/v1/admin/roles/${id}`, { permissions: [...selected], reason }),
    invalidate: [['roles']],
    success: 'Permissions updated',
    onSuccess: () => {
      setConfirm(null);
      setSelected(null);
    },
  });
  const remove = useApiMutation({
    mutationFn: () => api.delete(`/v1/admin/roles/${id}`),
    invalidate: [['roles']],
    success: 'Role deleted',
    onSuccess: () => router.push('/roles'),
  });
  const mine = useMemo(() => new Set(me?.admin?.permissions ?? []), [me]);

  if (role.isPending || catalogue.isPending) return <LoadingRows />;
  if (role.isError) return <ErrorState error={role.error} onRetry={() => role.refetch()} />;
  if (catalogue.isError) return <ErrorState error={catalogue.error} onRetry={() => catalogue.refetch()} />;
  const r = role.data;
  const current = selected ?? new Set(r.permissions);
  const editable = can('roles.manage') && r.key !== 'SUPER_ADMIN';
  const groups = catalogue.data.items.reduce(
    (acc, p) => ((acc[p.key.split('.')[0]] ??= []).push(p), acc),
    {},
  );
  const toggle = (key, on) => {
    const next = new Set(current);
    on ? next.add(key) : next.delete(key);
    setSelected(next);
  };

  return (
    <>
      <PageHeader
        back={{ href: '/roles', label: 'Roles' }}
        title={r.name}
        description={r.description}
        actions={
          <>
            {editable && selected ? (
              <Button onClick={() => setConfirm('save')}>Save permissions</Button>
            ) : null}
            {can('roles.manage') && !r.isSystem ? (
              <Button variant="outline" onClick={() => setConfirm('delete')}>
                Delete role
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {r.isSystem ? (
          <StatusBadge tone="info">System role</StatusBadge>
        ) : (
          <StatusBadge>Custom role</StatusBadge>
        )}
        {r.key === 'SUPER_ADMIN' ? (
          <StatusBadge tone="accent">Always has every permission</StatusBadge>
        ) : null}
        <StatusBadge>{current.size} permissions</StatusBadge>
        <StatusBadge>{r.adminCount} admins</StatusBadge>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(groups).map(([group, perms]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="text-sm capitalize">{group.replace('_', ' ')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {perms.map((p) => {
                const id = `perm-${p.key}`;
                const cannotGrant = !mine.has(p.key) && !current.has(p.key);
                return (
                  <div key={p.key} className="flex items-start gap-2">
                    <Checkbox
                      id={id}
                      checked={current.has(p.key)}
                      disabled={!editable || p.key === 'rbac.super' || cannotGrant}
                      onCheckedChange={(v) => toggle(p.key, Boolean(v))}
                    />
                    <Label htmlFor={id} className="grid gap-0.5 font-normal">
                      <span className="font-mono text-xs">{p.key}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.description}
                        {p.phase > 1 ? ` · used from Phase ${p.phase}` : ''}
                        {cannotGrant && editable ? ' · you do not hold this' : ''}
                      </span>
                    </Label>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'delete' ? `Delete ${r.name}?` : `Change permissions of ${r.name}?`}
        description={
          confirm === 'delete'
            ? 'Only roles with no admins can be deleted.'
            : `This affects ${r.adminCount} admin(s) immediately.`
        }
        destructive={confirm === 'delete'}
        requireReason={confirm === 'save'}
        busy={save.isPending || remove.isPending}
        onConfirm={(reason) => (confirm === 'delete' ? remove.mutate() : save.mutate({ reason }))}
      />
    </>
  );
}
