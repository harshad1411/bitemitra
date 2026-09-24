'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MOBILE_APPS } from '@jamzo/config/apps';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { FormField } from '@/components/jamzo/form-field';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';

function PolicyDialog({ policy, onClose }) {
  const [form, setForm] = useState({
    minSupportedVersion: policy.minSupportedVersion,
    recommendedVersion: policy.recommendedVersion,
    forceUpdate: policy.forceUpdate,
    storeUrl: policy.storeUrl ?? '',
  });
  const [reason, setReason] = useState('');
  const m = useApiMutation({
    mutationFn: () =>
      api.put(`/v1/admin/app-versions/${policy.appId}/${policy.platform}`, {
        ...form,
        storeUrl: form.storeUrl || null,
        reason: reason.trim() || undefined,
      }),
    invalidate: [['app-versions']],
    success: 'Version policy saved',
    onSuccess: onClose,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {MOBILE_APPS[policy.appId].displayName} · {policy.platform === 'IOS' ? 'iOS' : 'Android'}
          </DialogTitle>
          <DialogDescription>
            Builds below the minimum are blocked and asked to update. Builds below the recommended version see
            an optional update prompt.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField id="minv" label="Minimum supported" errors={m.fieldErrors.minSupportedVersion}>
              {(a) => <Input {...a} value={form.minSupportedVersion} onChange={set('minSupportedVersion')} />}
            </FormField>
            <FormField id="recv" label="Recommended" errors={m.fieldErrors.recommendedVersion}>
              {(a) => <Input {...a} value={form.recommendedVersion} onChange={set('recommendedVersion')} />}
            </FormField>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="force"
              checked={form.forceUpdate}
              onCheckedChange={(v) => setForm((f) => ({ ...f, forceUpdate: v }))}
            />
            <Label htmlFor="force">Force everyone below the recommended version to update</Label>
          </div>
          <FormField id="store" label="Store URL" errors={m.fieldErrors.storeUrl}>
            {(a) => <Input {...a} value={form.storeUrl} onChange={set('storeUrl')} placeholder="https://…" />}
          </FormField>
          <FormField
            id="vreason"
            label="Reason (required when raising the minimum)"
            errors={m.fieldErrors.reason}
          >
            {(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VersionsTab() {
  const { can } = useAuth();
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['app-versions'], queryFn: () => api.get('/v1/admin/app-versions') });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Card className="gap-0 overflow-x-auto py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>App</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Minimum</TableHead>
            <TableHead>Recommended</TableHead>
            <TableHead>Force update</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.data.items.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{MOBILE_APPS[p.appId]?.displayName ?? p.appId}</TableCell>
              <TableCell>{p.platform === 'IOS' ? 'iOS' : 'Android'}</TableCell>
              <TableCell className="font-mono">{p.minSupportedVersion}</TableCell>
              <TableCell className="font-mono">{p.recommendedVersion}</TableCell>
              <TableCell>{p.forceUpdate ? <StatusBadge tone="warning">Yes</StatusBadge> : 'No'}</TableCell>
              <TableCell className="text-muted-foreground">{formatDateTime(p.updatedAt)}</TableCell>
              <TableCell>
                {can('config.manage') ? (
                  <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {editing ? <PolicyDialog policy={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}
