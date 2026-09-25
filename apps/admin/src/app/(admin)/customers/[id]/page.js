'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { formatPaise } from '@jamzo/ui';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { statusLabel, statusTone } from '@/lib/orders';

export default function CustomerPage({ params }) {
  const { id } = use(params);
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api.get(`/v1/admin/customers/${id}`) });
  const [asking, setAsking] = useState(false);
  const [shown, setShown] = useState(null); // unmasked data lives only in this page's memory
  const reveal = useApiMutation({
    mutationFn: (reason) => api.post(`/v1/admin/customers/${id}/reveal`, { reason }),
    success: 'Contact details shown (recorded in the audit log)',
    onSuccess: (d) => {
      setShown(d);
      setAsking(false);
    },
  });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = shown ?? q.data;
  return (
    <>
      <PageHeader
        back={{ href: '/customers', label: 'Customers' }}
        title={c.name ?? 'Customer'}
        description={`Joined ${formatDateTime(c.createdAt)}`}
        actions={
          can('customers.pii') && !shown ? (
            <Button variant="outline" onClick={() => setAsking(true)}>
              <Eye /> Show contact details
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>
              Phone: <span className="font-mono">{c.phone ?? c.phoneMasked ?? '—'}</span>
            </p>
            <p>
              Email: <span className="font-mono">{c.email ?? c.emailMasked ?? '—'}</span>
            </p>
            <p>
              Status:{' '}
              <StatusBadge tone={c.status === 'ACTIVE' ? 'success' : 'critical'}>{c.status}</StatusBadge>{' '}
              {c.codDisabled ? <StatusBadge tone="warning">COD disabled</StatusBadge> : null}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {c.orders.recent.length ? (
              c.orders.recent.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="flex flex-wrap justify-between gap-2 hover:underline"
                >
                  <span>
                    <span className="font-mono text-xs">{o.orderNumber}</span> · {o.restaurantName}
                  </span>
                  <span className="tabular-nums">
                    {formatPaise(o.totalPayablePaise)}{' '}
                    <StatusBadge tone={statusTone(o.status)}>{statusLabel(o.status)}</StatusBadge>
                  </span>
                </Link>
              ))
            ) : (
              <p className="text-muted-foreground">No orders yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Saved addresses</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {c.addresses.length
              ? c.addresses.map((a) => (
                  <div key={a.id}>
                    <p className="font-medium">
                      {a.label} {a.isDefault ? <StatusBadge>Default</StatusBadge> : null}{' '}
                      {a.serviceable ? null : <StatusBadge tone="warning">Not serviceable</StatusBadge>}
                    </p>
                    <p className="text-muted-foreground">
                      {[a.line1, a.area, a.cityName, a.pincode].filter(Boolean).join(', ')}
                    </p>
                  </div>
                ))
              : 'None'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Favourites and consents</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>{c.favorites.length ? c.favorites.map((f) => f.name).join(', ') : 'No favourites'}</p>
            {c.consents.map((r, i) => (
              <p key={i} className="text-muted-foreground">
                {r.kind} v{r.version}: {r.granted ? 'granted' : 'withdrawn'} · {formatDateTime(r.createdAt)}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Show this customer’s contact details?"
        description="Only for a real support need. Your name, the time and the reason are recorded in the audit log."
        confirmLabel="Show details"
        requireReason
        busy={reveal.isPending}
        onConfirm={(reason) => reveal.mutate(reason)}
      />
    </>
  );
}
