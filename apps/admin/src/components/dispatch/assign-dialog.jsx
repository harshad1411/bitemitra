'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/jamzo/form-field';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { VEHICLE, minutesAgo } from '@/lib/riders';

/** Send an order to a chosen online partner (they still accept in the app). */
export function AssignDialog({ order, onClose }) {
  const board = useQuery({ queryKey: ['dispatch'], queryFn: () => api.get('/v1/admin/dispatch') });
  const riders = board.data?.riders ?? [];
  const [riderId, setRiderId] = useState(null);
  const [reason, setReason] = useState('');
  const m = useApiMutation({
    mutationFn: () => api.post(`/v1/admin/orders/${order.id}/assign`, { riderId, reason: reason.trim() }),
    invalidate: [['dispatch'], ['order', order.id]],
    success: 'Request sent to the partner',
    onSuccess: onClose,
  });
  const free = riders.filter((r) => r.activeOrderCount === 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {order.orderNumber}</DialogTitle>
          <DialogDescription>
            The partner gets the request and accepts it in the app. Recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-64 gap-1 overflow-y-auto">
          {free.length ? (
            free.map((r) => (
              <Button
                key={r.id}
                variant={riderId === r.id ? 'default' : 'outline'}
                className="justify-between"
                onClick={() => setRiderId(r.id)}
              >
                <span>{r.name}</span>
                <span className="text-xs opacity-80">
                  {VEHICLE[r.vehicle] ?? ''} · seen {minutesAgo(r.lastLocationAt) ?? '—'} min ago · cash{' '}
                  {formatPaise(r.codBalancePaise)}
                </span>
              </Button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No free partner is online.</p>
          )}
        </div>
        <FormField id="assign-reason" label="Why (required)">
          {(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!riderId || reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
