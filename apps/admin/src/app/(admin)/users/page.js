'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Users } from 'lucide-react';
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
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { FormField } from '@/components/jamzo/form-field';
import { GrantsEditor } from '@/components/jamzo/grants-editor';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';

const columns = [
  { header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
  { header: 'Email', accessorKey: 'email' },
  {
    header: 'Roles',
    cell: ({ row }) =>
      row.original.grants.map((g) => g.roleName + (g.cityId ? ' (one city)' : '')).join(', '),
  },
  { header: 'Last sign-in', cell: ({ row }) => formatDateTime(row.original.lastLoginAt) },
  {
    header: 'Status',
    cell: ({ row }) =>
      !row.original.isActive ? (
        <StatusBadge>Deactivated</StatusBadge>
      ) : row.original.lockedUntil && new Date(row.original.lockedUntil) > new Date() ? (
        <StatusBadge tone="warning">Locked</StatusBadge>
      ) : (
        <StatusBadge tone="success">Active</StatusBadge>
      ),
  },
];

function CreateAdminDialog({ onOpenChange }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [grants, setGrants] = useState([{ roleId: '', cityId: null }]);
  const m = useApiMutation({
    mutationFn: () => api.post('/v1/admin/users', { ...form, grants: grants.filter((g) => g.roleId) }),
    invalidate: [['admins']],
    success: (a) => `${a.email} can now sign in`,
    onSuccess: (a) => router.push(`/users/${a.id}`),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an admin user</DialogTitle>
          <DialogDescription>
            Share the temporary password privately. Self-service password reset is not built yet.
          </DialogDescription>
        </DialogHeader>
        <form id="create-admin" className="grid gap-3" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <FormField id="a-name" label="Name" errors={m.fieldErrors.name}>
            {(a) => <Input {...a} value={form.name} onChange={set('name')} />}
          </FormField>
          <FormField id="a-email" label="Work email" errors={m.fieldErrors.email}>
            {(a) => <Input {...a} type="email" value={form.email} onChange={set('email')} />}
          </FormField>
          <FormField
            id="a-password"
            label="Temporary password"
            help="At least 12 characters with upper- and lower-case letters and a number."
            errors={m.fieldErrors.password}
          >
            {(a) => (
              <Input
                {...a}
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={set('password')}
              />
            )}
          </FormField>
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Roles</span>
            <GrantsEditor grants={grants} onChange={setGrants} errors={m.fieldErrors.grants} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-admin" disabled={m.isPending}>
            {m.isPending ? 'Creating…' : 'Create admin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="Admin users"
        description="People who can sign in to Jamzo Admin. Restaurant and delivery partner accounts are managed in their own modules (Phases 2 and 6)."
        actions={
          can('admins.manage') ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Add admin
            </Button>
          ) : null
        }
      />
      <ResourceTable
        queryKey={['admins']}
        fetchPage={(p) => api.get('/v1/admin/users', p)}
        columns={columns}
        searchPlaceholder="Search by name or email"
        onRowClick={(a) => router.push(`/users/${a.id}`)}
        rowLabel={(a) => `Open ${a.email}`}
        empty={<EmptyState icon={Users} title="No admins found" />}
      />
      {open ? <CreateAdminDialog onOpenChange={setOpen} /> : null}
    </>
  );
}
