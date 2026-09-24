'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';

function FlagDialog({ flag, onClose }) {
  const [enabled, setEnabled] = useState(flag.enabled);
  const [rules, setRules] = useState(JSON.stringify(flag.rules ?? {}, null, 2));
  const [reason, setReason] = useState('');
  let parsed = null;
  try {
    parsed = JSON.parse(rules);
  } catch {
    parsed = null;
  }
  const m = useApiMutation({
    mutationFn: () =>
      api.put(`/v1/admin/flags/${flag.key}`, { enabled, rules: parsed, reason: reason.trim() || undefined }),
    invalidate: [['flags']],
    success: `${flag.key} updated`,
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-mono">{flag.key}</DialogTitle>
          <DialogDescription>{flag.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <Switch id="flag-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="flag-enabled">{enabled ? 'Enabled' : 'Disabled'}</Label>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="flag-rules">Targeting rules (JSON)</Label>
            <Textarea
              id="flag-rules"
              className="font-mono text-xs"
              rows={6}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional keys: apps, cityIds, zoneIds, minAppVersion, rolloutPercent (0–100).
            </p>
            {!parsed ? <p className="text-xs text-destructive">Not valid JSON</p> : null}
            {Object.entries(m.fieldErrors).map(([k, v]) => (
              <p key={k} className="text-xs text-destructive">
                {k}: {v.join(' ')}
              </p>
            ))}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="flag-reason">Reason (optional, audited)</Label>
            <Textarea id="flag-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!parsed || m.isPending} onClick={() => m.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FlagsTab() {
  const { can } = useAuth();
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['flags'], queryFn: () => api.get('/v1/admin/flags') });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y">
        {q.data.items.map((f) => (
          <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-mono text-sm">{f.key}</p>
              <p className="text-xs text-muted-foreground">{f.description}</p>
              {Object.keys(f.rules ?? {}).length ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  rules: {JSON.stringify(f.rules)}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone={f.enabled ? 'success' : 'neutral'}>{f.enabled ? 'On' : 'Off'}</StatusBadge>
              {can('flags.manage') ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(f)}>
                  Edit
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {editing ? <FlagDialog flag={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}
