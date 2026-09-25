'use client';

import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/jamzo/form-field';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { ROLE_LABEL } from '@/lib/restaurants';

const ROLE_HELP = {
  OWNER: 'Everything for this restaurant.',
  MANAGER: 'Store status, sold-out items, orders (Phase 5).',
  STAFF: 'Sold-out items and orders (Phase 5).',
};

function AddMemberDialog({ restaurantId, onClose }) {
  const [form, setForm] = useState({ phone: '', name: '', role: 'MANAGER' });
  const m = useApiMutation({
    mutationFn: () =>
      api.post(`/v1/admin/restaurants/${restaurantId}/members`, { ...form, name: form.name || null }),
    invalidate: [['restaurant', restaurantId]],
    success: 'Team member added',
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a team member</DialogTitle>
          <DialogDescription>
            They sign in to the Restaurant Partner app with this mobile number. Access still depends on the
            restaurant being approved.
          </DialogDescription>
        </DialogHeader>
        <form id="member-form" className="grid gap-3" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <FormField id="m-phone" label="Mobile number" errors={m.fieldErrors.phone}>
            {(a) => (
              <Input
                {...a}
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            )}
          </FormField>
          <FormField id="m-name" label="Name (optional)" errors={m.fieldErrors.name}>
            {(a) => (
              <Input
                {...a}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            )}
          </FormField>
          <FormField id="m-role" label="Role" help={ROLE_HELP[form.role]} errors={m.fieldErrors.role}>
            <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
              <SelectTrigger id="m-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="member-form" disabled={m.isPending}>
            Add member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeamTab({ restaurant }) {
  const { can } = useAuth();
  const editable = can('restaurants.manage');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const update = useApiMutation({
    mutationFn: ({ id, ...body }) => api.patch(`/v1/admin/restaurant-members/${id}`, body),
    invalidate: [['restaurant', restaurant.id]],
    success: 'Team updated',
    onSuccess: () => setRemoving(null),
  });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Team</CardTitle>
          <CardDescription>People who use the Restaurant Partner app for this restaurant.</CardDescription>
        </div>
        {editable ? (
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add member
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {!restaurant.members.length ? (
          <EmptyState icon={Users} title="No team members yet" description="Add the owner first." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {restaurant.members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <p className="font-medium">{m.user.name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{m.user.phone}</p>
                    </TableCell>
                    <TableCell>
                      {editable && m.isActive ? (
                        <Select value={m.role} onValueChange={(role) => update.mutate({ id: m.id, role })}>
                          <SelectTrigger
                            className="w-32"
                            aria-label={`Role of ${m.user.name ?? m.user.phone}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(ROLE_LABEL).map(([k, v]) => (
                              <SelectItem key={k} value={k}>
                                {v}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        ROLE_LABEL[m.role]
                      )}
                    </TableCell>
                    <TableCell>
                      {m.isActive ? (
                        <StatusBadge tone="success">Active</StatusBadge>
                      ) : (
                        <StatusBadge>Removed</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {editable ? (
                        m.isActive ? (
                          <Button
                            variant="link"
                            size="sm"
                            className="text-destructive"
                            onClick={() => setRemoving(m)}
                          >
                            Remove
                          </Button>
                        ) : (
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => update.mutate({ id: m.id, isActive: true })}
                          >
                            Restore
                          </Button>
                        )
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {adding ? <AddMemberDialog restaurantId={restaurant.id} onClose={() => setAdding(false)} /> : null}
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.user.name ?? removing?.user.phone} from the team?`}
        description="They lose access to this restaurant in the partner app immediately."
        confirmLabel="Remove"
        destructive
        requireReason
        busy={update.isPending}
        onConfirm={(reason) => update.mutate({ id: removing.id, isActive: false, reason })}
      />
    </Card>
  );
}
