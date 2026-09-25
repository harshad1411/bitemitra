'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState, ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DELIVERY_STATUS, VEHICLE, minutesAgo } from '@/lib/riders';
import { AssignDialog } from '@/components/dispatch/assign-dialog';

export default function DispatchPage() {
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['dispatch'],
    queryFn: () => api.get('/v1/admin/dispatch'),
    refetchInterval: 10_000,
  });
  const [assigning, setAssigning] = useState(null);
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { orders, riders } = q.data;
  const waiting = orders.filter((o) =>
    ['SEARCHING', 'ASSIGNED', 'NO_RIDER_FOUND'].includes(o.deliveryStatus),
  );
  return (
    <>
      <PageHeader
        title="Dispatch"
        description="Orders that need or have a delivery partner, and partners online now. Refreshed every 10 seconds."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              Orders ({orders.length}) · waiting for a partner: {waiting.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {orders.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Restaurant</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Partner</TableHead>
                    <TableHead>Cash</TableHead>
                    <TableHead className="sr-only">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link href={`/orders/${o.id}`} className="font-mono text-xs hover:underline">
                          {o.orderNumber}
                        </Link>
                        {o.needsAttention ? (
                          <StatusBadge tone="critical" className="ml-2">
                            Needs attention
                          </StatusBadge>
                        ) : null}
                      </TableCell>
                      <TableCell>{o.restaurant}</TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={
                            o.deliveryStatus === 'NO_RIDER_FOUND'
                              ? 'critical'
                              : o.deliveryStatus === 'SEARCHING'
                                ? 'warning'
                                : 'info'
                          }
                        >
                          {DELIVERY_STATUS[o.deliveryStatus] ?? o.deliveryStatus}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        {o.rider
                          ? `${o.rider.name}${o.rider.assignment === 'OFFERED' ? ' (asked)' : ''}`
                          : '—'}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {o.paymentMethod === 'COD' ? formatPaise(o.codAmountPaise) : 'Paid'}
                      </TableCell>
                      <TableCell className="text-right">
                        {can('orders.assign_rider') &&
                        ['SEARCHING', 'ASSIGNED', 'NO_RIDER_FOUND'].includes(o.deliveryStatus) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Assign ${o.orderNumber}`}
                            onClick={() => setAssigning(o)}
                          >
                            Assign
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                icon={Truck}
                title="Nothing to dispatch"
                description="Orders appear here once the restaurant accepts them."
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Partners online ({riders.length})</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {riders.length ? (
              riders.map((r) => (
                <Link
                  key={r.id}
                  href={`/riders/${r.id}`}
                  className="flex justify-between gap-2 hover:underline"
                >
                  <span>
                    {r.name} <span className="text-muted-foreground">· {VEHICLE[r.vehicle] ?? ''}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {r.activeOrderCount ? 'On a delivery' : 'Free'} · {minutesAgo(r.lastLocationAt) ?? '—'}{' '}
                    min
                  </span>
                </Link>
              ))
            ) : (
              <p className="text-muted-foreground">Nobody is online.</p>
            )}
            <p className="text-xs text-muted-foreground">A live map needs the maps key (Q-14).</p>
          </CardContent>
        </Card>
      </div>
      {assigning ? <AssignDialog order={assigning} onClose={() => setAssigning(null)} /> : null}
    </>
  );
}
