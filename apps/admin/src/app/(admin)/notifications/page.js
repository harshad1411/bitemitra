'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
          <FormField id="t-title" label="Title" errors={m.fieldErrors.title}>
            {(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </FormField>
          <FormField id="t-body" label="Message" errors={m.fieldErrors.body}>
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

/**
 * Offer notifications (D-116): only customers who switched "Offers and updates" on in the app receive them.
 * Count first, then confirm the send.
 */
function SendOffer() {
  const cities = useQuery({
    queryKey: ['cities', 'options'],
    queryFn: () => api.get('/v1/admin/geo/cities', { limit: 100 }),
  });
  const [form, setForm] = useState({ title: '', body: '', url: '', cityId: 'ALL' });
  const [count, setCount] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const set = (k) => (v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setCount(null);
  };
  const payload = (send) => ({
    title: form.title,
    body: form.body,
    url: form.url.trim() || null,
    cityId: form.cityId === 'ALL' ? null : form.cityId,
    send,
  });
  const check = useApiMutation({
    mutationFn: () => api.post('/v1/admin/offer-notifications', payload(false)),
    onSuccess: (r) => setCount(r.recipients),
  });
  const send = useApiMutation({
    mutationFn: () => api.post('/v1/admin/offer-notifications', payload(true)),
    success: (r) => `Offer sent to ${r.recipients} customer${r.recipients === 1 ? '' : 's'}`,
    onSuccess: () => {
      setConfirming(false);
      setCount(null);
      setForm({ title: '', body: '', url: '', cityId: 'ALL' });
    },
  });
  const errors = { ...check.fieldErrors, ...send.fieldErrors };
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Send an offer</CardTitle>
        <CardDescription>
          Goes only to customers who turned on “Offers and updates” in the app. Order updates are separate.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:max-w-2xl">
        <FormField id="o-title" label="Title" errors={errors.title}>
          {(a) => (
            <Input
              {...a}
              maxLength={65}
              value={form.title}
              onChange={(e) => set('title')(e.target.value)}
              placeholder="Pizza Friday"
            />
          )}
        </FormField>
        <FormField id="o-body" label="Message" errors={errors.body}>
          {(a) => (
            <Textarea
              {...a}
              rows={2}
              maxLength={178}
              value={form.body}
              onChange={(e) => set('body')(e.target.value)}
              placeholder="20% off at Pizza Point today, up to ₹75"
            />
          )}
        </FormField>
        <FormField id="o-url" label="Opens in the app (optional)" errors={errors.url}>
          {(a) => (
            <Input
              {...a}
              value={form.url}
              onChange={(e) => set('url')(e.target.value)}
              placeholder="/search?q=pizza"
            />
          )}
        </FormField>
        <FormField id="o-city" label="Who">
          {(a) => (
            <Select value={form.cityId} onValueChange={set('cityId')}>
              <SelectTrigger id={a.id} aria-label="City">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All cities</SelectItem>
                {(cities.data?.items ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
            Check recipients
          </Button>
          {count != null ? (
            <span className="text-sm">
              {count === 0
                ? 'Nobody to send to yet: no customer with the app has turned offers on.'
                : `${count} customer${count === 1 ? '' : 's'} will receive it.`}
            </span>
          ) : null}
          {count ? <Button onClick={() => setConfirming(true)}>Send to {count}</Button> : null}
        </div>
      </CardContent>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this offer to {count} customers?</DialogTitle>
            <DialogDescription>
              “{form.title}” — {form.body}. It cannot be taken back once sent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => send.mutate()} disabled={send.isPending}>
              Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
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
      <SendOffer />
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
