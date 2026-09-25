'use client';

import { useState } from 'react';
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
import { FormField } from '@/components/jamzo/form-field';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';

/**
 * Create settlements now: for today's due periods (each ledger's schedule), or for a chosen period in India
 * dates (end not included). Existing settlements are never duplicated.
 */
export function RunDialog({ kind, onClose }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const m = useApiMutation({
    mutationFn: () => api.post('/v1/admin/settlements/run', { kind, ...(from && to ? { from, to } : {}) }),
    invalidate: [['settlements']],
    success: (r) =>
      `${r.created} created · ${r.carriedForward} carried forward (below the minimum or nothing new)${r.notDue ? ` · ${r.notDue} not due today` : ''}`,
    onSuccess: onClose,
  });
  const partial = Boolean(from) !== Boolean(to);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === 'RESTAURANT' ? 'Run restaurant settlements' : 'Run delivery partner settlements'}
          </DialogTitle>
          <DialogDescription>
            Leave the dates empty to settle what is due today by each schedule. Jamzo does not move money: you
            pay outside Jamzo and record the reference.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="run-from" label="From (optional)">
            {(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </FormField>
          <FormField id="run-to" label="Until, not included">
            {(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={partial || m.isPending} onClick={() => m.mutate()}>
            Run now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
