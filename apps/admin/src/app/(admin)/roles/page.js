'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { FormField } from '@/components/jamzo/form-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';

function CreateRoleDialog({ onOpenChange }) {
  const router = useRouter();
  const [form, setForm] = useState({ key: '', name: '', description: '' });
  const m = useApiMutation({
    mutationFn: () => api.post('/v1/admin/roles', { ...form, permissions: ['dashboard.view'] }),
    invalidate: [['roles']],
    success: 'Role created — now choose its permissions',
    onSuccess: (r) => router.push(`/roles/${r.id}`),
  });
  const set = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: k === 'key' ? e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') : e.target.value,
    }));
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a custom role</DialogTitle>
          <DialogDescription>You can only grant permissions you hold yourself.</DialogDescription>
        </DialogHeader>
        <form id="create-role" className="grid gap-3" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <FormField id="r-name" label="Name" errors={m.fieldErrors.name}>
            {(a) => <Input {...a} value={form.name} onChange={set('name')} placeholder="Support lead" />}
          </FormField>
          <FormField
            id="r-key"
            label="Key"
            help="UPPER_SNAKE_CASE, cannot be changed later."
            errors={m.fieldErrors.key}
          >
            {(a) => <Input {...a} value={form.key} onChange={set('key')} placeholder="SUPPORT_LEAD" />}
          </FormField>
          <FormField id="r-desc" label="Description" errors={m.fieldErrors.description}>
            {(a) => <Input {...a} value={form.description} onChange={set('description')} />}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-role" disabled={m.isPending}>
            Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RolesPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/v1/admin/roles') });
  return (
    <>
      <PageHeader
        title="Roles"
        description="A role is a named set of permissions. The API enforces every permission; hiding something here is only a convenience."
        actions={
          can('roles.manage') ? (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Create role
            </Button>
          ) : null
        }
      />
      {q.isPending ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card className="gap-0 overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Admins</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((r) => (
                <TableRow
                  key={r.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => router.push(`/roles/${r.id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && router.push(`/roles/${r.id}`)}
                >
                  <TableCell>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.description}</p>
                  </TableCell>
                  <TableCell>
                    {r.isSystem ? (
                      <StatusBadge tone="info">System</StatusBadge>
                    ) : (
                      <StatusBadge>Custom</StatusBadge>
                    )}
                    {r.cityScoped ? <StatusBadge className="ml-1">City-limited</StatusBadge> : null}
                  </TableCell>
                  <TableCell className="tabular-nums">{r.permissions.length}</TableCell>
                  <TableCell className="tabular-nums">{r.adminCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {open ? <CreateRoleDialog onOpenChange={setOpen} /> : null}
    </>
  );
}
