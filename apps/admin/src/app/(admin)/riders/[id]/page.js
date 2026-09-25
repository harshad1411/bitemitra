'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatPaise, parseRupeesToPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { FormField } from '@/components/jamzo/form-field';
import { PageHeader } from '@/components/jamzo/page-header';
import { PriceInput } from '@/components/jamzo/price-input';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { statusLabel, statusTone } from '@/lib/orders';
import { DOC_KIND, RIDER_STATUS, VEHICLE, minutesAgo } from '@/lib/riders';
import { openPrivateFile } from '@/lib/upload';

const STATUS_ACTION = {
  DOCUMENT_PENDING: 'Ask for documents',
  UNDER_REVIEW: 'Move to review',
  ACTIVE: 'Approve (go live)',
  SUSPENDED: 'Suspend',
  REJECTED: 'Reject',
};
const DOC_TONE = { PENDING: 'warning', VERIFIED: 'success', REJECTED: 'critical' };

export default function RiderPage({ params }) {
  const { id } = use(params);
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['rider', id], queryFn: () => api.get(`/v1/admin/riders/${id}`) });
  const [transition, setTransition] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [cod, setCod] = useState(null); // { enabled, limit }
  const [codAsk, setCodAsk] = useState(false);
  const status = useApiMutation({
    mutationFn: ({ to, reason }) => api.post(`/v1/admin/riders/${id}/status`, { to, reason }),
    invalidate: [['rider', id], ['riders']],
    success: 'Status changed',
    onSuccess: () => setTransition(null),
  });
  const review = useApiMutation({
    mutationFn: ({ docId, status: s, note }) =>
      api.post(`/v1/admin/rider-documents/${docId}/review`, { status: s, note: note || undefined }),
    invalidate: [['rider', id]],
    success: 'Document reviewed',
    onSuccess: () => setRejecting(null),
  });
  const codSave = useApiMutation({
    mutationFn: (reason) =>
      api.patch(`/v1/admin/riders/${id}/cod`, {
        codEnabled: cod.enabled,
        codLimitPaise: cod.limit.trim() ? parseRupeesToPaise(cod.limit) : null,
        reason,
      }),
    invalidate: [['rider', id]],
    success: 'Cash settings saved',
    onSuccess: () => {
      setCod(null);
      setCodAsk(false);
    },
  });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const [label, tone] = RIDER_STATUS[r.onboardingStatus] ?? [r.onboardingStatus, 'neutral'];
  const c = cod ?? {
    enabled: r.cod.enabled,
    limit: r.cod.limitPaise != null ? String(r.cod.limitPaise / 100) : '',
  };
  return (
    <>
      <PageHeader
        back={{ href: '/riders', label: 'Delivery partners' }}
        title={r.name ?? 'Delivery partner'}
        description={`Joined ${formatDateTime(r.createdAt)}`}
        actions={
          can('riders.approve') ? (
            <div className="flex flex-wrap gap-2">
              {r.nextStatuses.map((to) => (
                <Button
                  key={to}
                  variant={to === 'ACTIVE' ? 'default' : 'outline'}
                  onClick={() => setTransition(to)}
                >
                  {STATUS_ACTION[to]}
                </Button>
              ))}
            </div>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Partner</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>
              <StatusBadge tone={tone}>{label}</StatusBadge>{' '}
              {r.online ? (
                <StatusBadge tone="success">Online</StatusBadge>
              ) : (
                <StatusBadge>Offline</StatusBadge>
              )}
            </p>
            <p className="font-mono">{r.phone ?? r.phoneMasked}</p>
            <p>
              {r.vehicle
                ? `${VEHICLE[r.vehicle.type]} ${r.vehicle.registrationNumber ?? ''}`
                : 'No vehicle yet'}
            </p>
            {r.addressLine ? <p className="text-muted-foreground">{r.addressLine}</p> : null}
            <p>Active orders: {r.activeOrderCount}</p>
            {r.position ? (
              <p className="text-muted-foreground">
                Last location {minutesAgo(r.position.at)} min ago ({r.position.lat.toFixed(4)},{' '}
                {r.position.lng.toFixed(4)})
              </p>
            ) : null}
            <p>
              Earnings so far: {formatPaise(r.earnings.totalPaise)} ({r.earnings.count} trips)
            </p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent>
            {r.documents.missing.length ? (
              <p className="mb-2 text-sm text-muted-foreground">
                Missing: {r.documents.missing.map((k) => DOC_KIND[k]).join(', ')}
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.documents.items.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{DOC_KIND[d.kind] ?? d.kind}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {d.numberLast4 ? `•••• ${d.numberLast4}` : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={DOC_TONE[d.status]}>
                        {d.status === 'VERIFIED'
                          ? 'Verified'
                          : d.status === 'REJECTED'
                            ? 'Rejected'
                            : 'To review'}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>{formatDateTime(d.uploadedAt)}</TableCell>
                    <TableCell className="space-x-1 text-right whitespace-nowrap">
                      {d.hasFile ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            openPrivateFile(`/v1/admin/rider-documents/${d.id}/file`).catch((e) =>
                              toast.error(e.message),
                            )
                          }
                        >
                          View
                        </Button>
                      ) : null}
                      {can('riders.approve') && d.status === 'PENDING' ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Verify ${DOC_KIND[d.kind]}`}
                            onClick={() => review.mutate({ docId: d.id, status: 'VERIFIED' })}
                          >
                            Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Reject ${DOC_KIND[d.kind]}`}
                            onClick={() => setRejecting(d)}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cash on delivery</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <p>
              Cash in hand:{' '}
              <span className="font-semibold tabular-nums">{formatPaise(r.cod.balancePaise)}</span>
            </p>
            <p className="text-muted-foreground">{r.cod.depositsNote}</p>
            <label className="flex items-center gap-2">
              <Switch
                checked={c.enabled}
                disabled={!can('riders.manage')}
                onCheckedChange={(enabled) => setCod({ ...c, enabled })}
                aria-label="Can take cash-on-delivery orders"
              />
              Can take cash-on-delivery orders
            </label>
            <FormField
              id="cod-limit"
              label={`Cash limit (empty = city default ${r.cod.inheritedLimitPaise != null ? formatPaise(r.cod.inheritedLimitPaise) : '—'})`}
            >
              {(a) => (
                <PriceInput
                  {...a}
                  value={c.limit}
                  disabled={!can('riders.manage')}
                  onChange={(limit) => setCod({ ...c, limit })}
                />
              )}
            </FormField>
            {can('riders.manage') && cod ? (
              <Button className="w-fit" onClick={() => setCodAsk(true)}>
                Save cash settings
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {r.recentOrders.length ? (
              r.recentOrders.map((o) => (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="flex justify-between gap-2 hover:underline"
                >
                  <span>
                    <span className="font-mono text-xs">{o.orderNumber}</span> · {o.restaurantName}
                  </span>
                  <StatusBadge tone={statusTone(o.status)}>{statusLabel(o.status)}</StatusBadge>
                </Link>
              ))
            ) : (
              <p className="text-muted-foreground">No orders yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog
        open={Boolean(transition)}
        onOpenChange={(o) => !o && setTransition(null)}
        title={transition ? `${STATUS_ACTION[transition]}?` : ''}
        description={
          transition === 'ACTIVE'
            ? 'Every required document must be verified. The partner can go online right away.'
            : 'The reason is recorded in the audit log.'
        }
        confirmLabel={transition ? STATUS_ACTION[transition] : 'Confirm'}
        destructive={transition === 'SUSPENDED' || transition === 'REJECTED'}
        requireReason
        busy={status.isPending}
        onConfirm={(reason) => status.mutate({ to: transition, reason })}
      />
      <ConfirmDialog
        open={Boolean(rejecting)}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject ${rejecting ? DOC_KIND[rejecting.kind] : ''}?`}
        description="Tell the partner what is wrong; they see this note and upload again."
        confirmLabel="Reject document"
        destructive
        requireReason
        busy={review.isPending}
        onConfirm={(note) => review.mutate({ docId: rejecting.id, status: 'REJECTED', note })}
      />
      <ConfirmDialog
        open={codAsk}
        onOpenChange={setCodAsk}
        title="Save cash settings?"
        description="The reason is recorded in the audit log."
        confirmLabel="Save"
        requireReason
        busy={codSave.isPending}
        onConfirm={(reason) => codSave.mutate(reason)}
      />
    </>
  );
}
