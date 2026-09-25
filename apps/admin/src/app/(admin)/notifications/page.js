'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/jamzo/form-field';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';

const EVENT_LABEL = {
  'order.placed': 'Order placed',
  'order.accepted': 'Restaurant accepted',
  'order.preparing': 'Preparing',
  'order.ready': 'Ready for pickup',
  'order.rejected': 'Restaurant rejected',
  'order.cancelled': 'Order cancelled',
};
const APP_LABEL = { CUSTOMER: 'Customer app', RESTAURANT: 'Restaurant app' };

function EditDialog({ t, placeholders, onClose }) {
  const [title, setTitle] = useState(t.title ?? '');
  const [body, setBody] = useState(t.body);
  const [isActive, setActive] = useState(t.isActive);
  const m = useApiMutation({
    mutationFn: () => api.patch(`/v1/admin/notification-templates/${t.id}`, { title, body, isActive }),
    invalidate: [['notification-templates']],
    success: 'Template saved',
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {EVENT_LABEL[t.event] ?? t.event} · {APP_LABEL[t.appId] ?? t.appId}
          </DialogTitle>
          <DialogDescription>
            Placeholders: {placeholders.map((p) => `{{${p}}}`).join(', ')}. Changes apply to the next
            notification.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField id="t-title" label="Title" error={m.fieldErrors.title?.[0]}>
            {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </FormField>
          <FormField id="t-body" label="Message" error={m.fieldErrors.body?.[0]}>
            {(a) => <Textarea {...a} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />}
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={isActive} onCheckedChange={setActive} /> Send this notification
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !body.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NotificationsPage() {
  const q = useQuery({
    queryKey: ['notification-templates'],
    queryFn: () => api.get('/v1/admin/notification-templates'),
  });
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Messages sent to customers and restaurants when an order changes. Development builds deliver to the console only; real push needs the Expo projects (Q-18)."
      />
      {q.isPending ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>App</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{EVENT_LABEL[t.event] ?? t.event}</TableCell>
                    <TableCell>{APP_LABEL[t.appId] ?? t.appId}</TableCell>
                    <TableCell>
                      <p className="font-medium">{t.title}</p>
                      <p className="text-muted-foreground">{t.body}</p>
                    </TableCell>
                    <TableCell>
                      {t.isActive ? (
                        <StatusBadge tone="success">On</StatusBadge>
                      ) : (
                        <StatusBadge>Off</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${EVENT_LABEL[t.event] ?? t.event} for ${APP_LABEL[t.appId]}`}
                        onClick={() => setEditing(t)}
                      >
                        <Pencil />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {editing ? (
        <EditDialog t={editing} placeholders={q.data.placeholders} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}
