'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { GrantsEditor } from '@/components/jamzo/grants-editor';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';

export default function AdminUserPage({ params }) {
  const { id } = use(params);
  const { can, me } = useAuth();
  const q = useQuery({ queryKey: ['admins', id], queryFn: () => api.get(`/v1/admin/users/${id}`) });
  const [grants, setGrants] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'grants' | 'status'
  const save = useApiMutation({
    mutationFn: ({ reason }) =>
      api.patch(
        `/v1/admin/users/${id}`,
        confirm === 'grants'
          ? { grants: grants.filter((g) => g.roleId), reason }
          : { isActive: !q.data.isActive, reason },
      ),
    invalidate: [['admins']],
    success: 'Admin updated',
    onSuccess: () => {
      setConfirm(null);
      setGrants(null);
    },
  });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const self = a.userId === me?.user?.id;
  const editing = grants ?? a.grants.map((g) => ({ roleId: g.roleId, cityId: g.cityId }));
  return (
    <>
      <PageHeader
        back={{ href: '/users', label: 'Admin users' }}
        title={a.name ?? a.email}
        description={a.email}
        actions={
          can('admins.manage') && !self ? (
            <Button variant={a.isActive ? 'outline' : 'default'} onClick={() => setConfirm('status')}>
              {a.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Roles</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {can('admins.manage') && !self ? (
              <>
                <GrantsEditor grants={editing} onChange={setGrants} errors={save.fieldErrors.grants} />
                <Button
                  className="justify-self-start"
                  disabled={!grants}
                  onClick={() => setConfirm('grants')}
                >
                  Save roles
                </Button>
              </>
            ) : (
              <ul className="text-sm">
                {a.grants.map((g) => (
                  <li key={`${g.roleId}-${g.cityId}`}>
                    {g.roleName}
                    {g.cityId ? ' (one city)' : ''}
                  </li>
                ))}
                {self ? (
                  <li className="mt-2 text-xs text-muted-foreground">You cannot change your own roles.</li>
                ) : null}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <div>
              {a.isActive ? (
                <StatusBadge tone="success">Active</StatusBadge>
              ) : (
                <StatusBadge>Deactivated</StatusBadge>
              )}
            </div>
            <p>Last sign-in: {formatDateTime(a.lastLoginAt)}</p>
            <p>Created: {formatDateTime(a.createdAt)}</p>
            {a.lockedUntil && new Date(a.lockedUntil) > new Date() ? (
              <p className="text-amber-800">Locked until {formatDateTime(a.lockedUntil)}</p>
            ) : null}
            {can('audit.view') ? (
              <Link className="text-primary hover:underline" href={`/audit?actorId=${a.userId}`}>
                View this admin’s activity
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm === 'grants'
            ? 'Change roles?'
            : a.isActive
              ? `Deactivate ${a.email}?`
              : `Reactivate ${a.email}?`
        }
        description={
          confirm === 'status' && a.isActive
            ? 'They are signed out everywhere immediately.'
            : 'Permissions change immediately.'
        }
        destructive={confirm === 'status' && a.isActive}
        requireReason
        busy={save.isPending}
        onConfirm={(reason) => save.mutate({ reason })}
      />
    </>
  );
}
