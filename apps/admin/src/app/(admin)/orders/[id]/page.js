'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban } from 'lucide-react';
import { formatPaise, parseRupeesToPaise } from '@jamzo/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/jamzo/form-field';
import { PageHeader } from '@/components/jamzo/page-header';
import { PriceInput } from '@/components/jamzo/price-input';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime, titleCase } from '@/lib/format';
import { ACTOR_LABEL, ADMIN_CANCEL_REASONS, statusLabel, statusTone } from '@/lib/orders';
import { DELIVERY_STATUS } from '@/lib/riders';
import { AssignDialog } from '@/components/dispatch/assign-dialog';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { RefundDialog } from '@/components/payments/refund-dialog';
import { METHOD, PAYMENT_STATUS, REFUND_STATUS, REFUND_TYPE } from '@/lib/payments';

/** What each "needs attention" reason means and what to do (the API sets the reason). */
const ATTENTION = {
  RESTAURANT_NOT_RESPONDING:
    'The restaurant has not responded. Call them, or cancel the order. If nobody acts, the order is rejected automatically after the grace period.',
  NO_RIDER_FOUND: 'No delivery partner accepted. Assign one below; dispatch keeps retrying every minute.',
  DELIVERY_CODE_ATTEMPTS:
    'The delivery partner entered a wrong delivery code 5 times. Call the customer before anything else.',
  PAYMENT_AMOUNT_MISMATCH:
    'The payment gateway reports a different amount than the order total. Check the payment; never confirm the order by hand.',
  LATE_PAYMENT_REFUNDED:
    'Money arrived after the order had ended. A full refund was created automatically; check it completes.',
  REFUND_FAILED:
    'A refund failed at the payment gateway after several tries. Retry it from Refunds or contact the gateway.',
  DEFAULT:
    'The delivery partner reported a problem or something needs a person. Check the order and its history.',
};

const rupees = (p) => (p == null ? '—' : formatPaise(p));
const neg = (p) => (p ? `−${formatPaise(p)}` : formatPaise(0));

function Rows({ rows }) {
  return (
    <Table>
      <TableBody>
        {rows.map(([label, value, strong]) => (
          <TableRow key={label}>
            <TableCell className={`whitespace-normal ${strong ? 'font-medium' : 'text-muted-foreground'}`}>
              {label}
            </TableCell>
            <TableCell className={`text-right tabular-nums ${strong ? 'font-semibold' : ''}`}>
              {value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CancelDialog({ order, onClose }) {
  const [reasonCode, setReasonCode] = useState('CUSTOMER_REQUEST');
  const [reasonText, setReasonText] = useState('');
  const [override, setOverride] = useState(false);
  const [amounts, setAmounts] = useState({ fee: '0', restaurant: '0', rider: '0' });
  const [local, setLocal] = useState(null);
  const pickedUp = ['PICKED_UP', 'ON_THE_WAY', 'ARRIVED'].includes(order.deliveryStatus);
  const [riderIssue, setRiderIssue] = useState(false);
  const m = useApiMutation({
    mutationFn: (body) => api.post(`/v1/admin/orders/${order.id}/cancel`, body),
    invalidate: [['order', order.id], ['orders']],
    success: 'Order cancelled',
    onSuccess: onClose,
  });
  const submit = () => {
    if (reasonText.trim().length < 3) return setLocal('Describe what happened (recorded in the audit log).');
    let o;
    if (override) {
      o = {
        customerFeePaise: parseRupeesToPaise(amounts.fee || '0'),
        restaurantCompensationPaise: parseRupeesToPaise(amounts.restaurant || '0'),
        riderCompensationPaise: parseRupeesToPaise(amounts.rider || '0'),
      };
      if (Object.values(o).some((v) => v == null)) return setLocal('Use amounts like 50 or 50.25.');
    }
    setLocal(null);
    m.mutate({
      reasonCode,
      reasonText: reasonText.trim(),
      riderIssue,
      version: order.version,
      ...(o ? { override: o } : {}),
    });
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancel order {order.orderNumber}?</DialogTitle>
          <DialogDescription>
            The cancellation rule in force decides fees and compensation; you can override them with a reason.
            The outcome is recorded; refunds (Phase 7) and settlements (Phase 8) are not made yet.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField id="c-reason" label="Reason">
            <Select value={reasonCode} onValueChange={setReasonCode}>
              <SelectTrigger id="c-reason" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_CANCEL_REASONS.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="c-text" label="What happened (required)">
            {(a) => (
              <Textarea {...a} rows={2} value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
            )}
          </FormField>
          {pickedUp ? (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={riderIssue} onCheckedChange={setRiderIssue} /> Delivery partner problem
              (accident, food lost)
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={override}
              onCheckedChange={setOverride}
              aria-label="Override the computed amounts"
            />{' '}
            Override the computed amounts
          </label>
          {override ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['fee', 'Customer fee'],
                ['restaurant', 'Restaurant gets'],
                ['rider', 'Rider gets'],
              ].map(([k, l]) => (
                <FormField key={k} id={`c-${k}`} label={l}>
                  {(a) => (
                    <PriceInput
                      {...a}
                      value={amounts[k]}
                      onChange={(v) => setAmounts((x) => ({ ...x, [k]: v }))}
                    />
                  )}
                </FormField>
              ))}
            </div>
          ) : null}
          {local ? (
            <Alert variant="destructive">
              <AlertDescription>{local}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep order
          </Button>
          <Button variant="destructive" onClick={submit} disabled={m.isPending}>
            {m.isPending ? 'Cancelling…' : 'Cancel order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function OrderPage({ params }) {
  const { id } = use(params);
  const q = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get(`/v1/admin/orders/${id}`),
    refetchInterval: 15_000,
  });
  const [cancelling, setCancelling] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const unassign = useApiMutation({
    mutationFn: (reason) => api.post(`/v1/admin/orders/${id}/unassign`, { reason }),
    invalidate: [['order', id], ['dispatch']],
    success: 'Partner removed — finding another',
    onSuccess: () => setUnassigning(false),
  });
  const [note, setNote] = useState('');
  const [resolveNote, setResolveNote] = useState('');
  const addNote = useApiMutation({
    mutationFn: () => api.post(`/v1/admin/orders/${id}/notes`, { body: note.trim() }),
    invalidate: [['order', id]],
    success: 'Note added',
    onSuccess: () => setNote(''),
  });
  const resolve = useApiMutation({
    mutationFn: () =>
      api.post(`/v1/admin/orders/${id}/attention`, { resolved: true, note: resolveNote.trim() }),
    invalidate: [['order', id], ['orders']],
    success: 'Marked as handled',
    onSuccess: () => setResolveNote(''),
  });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const s = o.pricingSnapshot;
  const pl = s?.platformRevenue ?? {};
  return (
    <>
      <PageHeader
        back={{ href: '/orders', label: 'Orders' }}
        title={`Order ${o.orderNumber}`}
        description={`${o.restaurant.name} · ${o.restaurant.city ?? ''} · placed ${formatDateTime(o.placedAt ?? o.createdAt)}`}
        actions={
          o.permissions.cancel && o.cancelPreview?.possible ? (
            <Button variant="destructive" onClick={() => setCancelling(true)}>
              <Ban /> Cancel order
            </Button>
          ) : null
        }
      />
      {o.needsAttention ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle />
          <AlertTitle>Needs attention: {titleCase(o.attentionReason ?? '')}</AlertTitle>
          <AlertDescription>
            <p>{ATTENTION[o.attentionReason] ?? ATTENTION.DEFAULT}</p>
            {o.permissions.edit ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Textarea
                  aria-label="What was done"
                  rows={1}
                  className="max-w-sm"
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  placeholder="e.g. Called the restaurant, they are accepting now"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={resolveNote.trim().length < 3 || resolve.isPending}
                  onClick={() => resolve.mutate()}
                >
                  Mark as handled
                </Button>
              </div>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              <StatusBadge tone={statusTone(o.status)}>{statusLabel(o.status)}</StatusBadge>
            </p>
            <p>Kitchen: {titleCase(o.restaurantStatus)}</p>
            <p>Delivery: {titleCase(o.deliveryStatus)}</p>
            <p>Money: {titleCase(o.financialStatus)}</p>
            {o.prepTimeMinutes ? <p>Preparation time: {o.prepTimeMinutes} min</p> : null}
            {o.estimatedReadyAt ? <p>Ready by about {formatDateTime(o.estimatedReadyAt)}</p> : null}
            <p className="text-muted-foreground">
              {o.platform ?? '—'} · app {o.appVersion ?? '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p className="font-medium">
              <Link className="underline-offset-2 hover:underline" href={`/customers/${o.customer.id}`}>
                {o.customer.name ?? 'Customer'}
              </Link>
            </p>
            <p className="font-mono">{o.customer.phone ?? '—'}</p>
            {o.address ? (
              <p className="text-muted-foreground">
                {[o.address.label, o.address.line1, o.address.landmark, o.address.cityName]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            ) : null}
            {o.customer.masked ? (
              <p className="text-xs text-muted-foreground">Contact details are masked (customers.pii).</p>
            ) : null}
            {o.deliveryInstructions ? <p>Delivery note: {o.deliveryInstructions}</p> : null}
            {o.restaurantInstructions ? <p>Kitchen note: {o.restaurantInstructions}</p> : null}
            {o.contactless ? <StatusBadge>Contactless</StatusBadge> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>{o.payment.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{rupees(o.totalPayablePaise)}</p>
            {o.payment.method === 'COD' ? (
              <p className="text-muted-foreground">
                To be collected by the delivery partner ({rupees(o.payment.codAmountPaise)}).
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>
              <StatusBadge tone={o.deliveryStatus === 'NO_RIDER_FOUND' ? 'critical' : 'info'}>
                {DELIVERY_STATUS[o.deliveryStatus] ?? o.deliveryStatus}
              </StatusBadge>
            </p>
            {o.assignments?.length ? (
              <ol className="grid gap-1">
                {o.assignments.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <Link className="hover:underline" href={`/riders/${a.riderId}`}>
                      {a.riderName}
                      {a.manual ? ' (manual)' : ''}
                    </Link>
                    <span className="text-muted-foreground">
                      {titleCase(a.status)}
                      {a.rejectReason ? ` · ${titleCase(a.rejectReason)}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground">No delivery partner asked yet.</p>
            )}
            {o.permissions.assignRider &&
            ['SEARCHING', 'ASSIGNED', 'NO_RIDER_FOUND'].includes(o.deliveryStatus) ? (
              <Button size="sm" className="w-fit" onClick={() => setAssigning(true)}>
                Assign a partner
              </Button>
            ) : null}
            {o.permissions.assignRider && ['ACCEPTED', 'AT_RESTAURANT'].includes(o.deliveryStatus) ? (
              <Button size="sm" variant="outline" className="w-fit" onClick={() => setUnassigning(true)}>
                Take order from partner
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments & refunds</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {o.payments.length ? (
              o.payments.map((p) => (
                <div key={p.id} className="flex justify-between gap-2">
                  <Link className="hover:underline" href={`/payments/${p.id}`}>
                    {METHOD[p.method] ?? p.method} · {formatPaise(p.amountPaise)}
                  </Link>
                  <StatusBadge tone={PAYMENT_STATUS[p.status]?.[1] ?? 'neutral'}>
                    {PAYMENT_STATUS[p.status]?.[0] ?? p.status}
                  </StatusBadge>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                {o.payment?.method === 'COD'
                  ? 'Cash is recorded when the partner collects it.'
                  : 'No payment yet.'}
              </p>
            )}
            {o.refunds.map((r) => (
              <div key={r.id} className="flex justify-between gap-2">
                <span>
                  Refund: {REFUND_TYPE[r.type]} · {formatPaise(r.amountPaise)}
                </span>
                <StatusBadge tone={REFUND_STATUS[r.status]?.[1] ?? 'neutral'}>
                  {REFUND_STATUS[r.status]?.[0] ?? r.status}
                </StatusBadge>
              </div>
            ))}
            <p className="text-muted-foreground">Can still be refunded: {formatPaise(o.refundablePaise)}</p>
            {o.permissions.refund && o.refundablePaise > 0 ? (
              <Button size="sm" variant="outline" className="w-fit" onClick={() => setRefunding(true)}>
                Refund
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Restaurant price</TableHead>
                  <TableHead className="text-right">Customer price</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <p className="font-medium">
                        {i.productName}
                        {i.variantName ? ` (${i.variantName})` : ''}
                      </p>
                      {i.addons.length ? (
                        <p className="text-xs text-muted-foreground">
                          {i.addons.map((a) => `${a.groupName}: ${a.name}`).join(' · ')}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rupees(i.restaurantBasePricePaise)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rupees(i.customerDisplayPricePaise)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{rupees(i.lineTotalPaise)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Customer bill</CardTitle>
          </CardHeader>
          <CardContent>
            {o.bill ? (
              <Rows
                rows={[
                  ...o.bill.lines.map((l) => [
                    l.label,
                    l.amountPaise < 0 ? neg(-l.amountPaise) : rupees(l.amountPaise),
                  ]),
                  ['Total payable', rupees(o.bill.totalPayablePaise), true],
                ]}
              />
            ) : (
              '—'
            )}
          </CardContent>
        </Card>

        {s ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Restaurant side</CardTitle>
              </CardHeader>
              <CardContent>
                <Rows
                  rows={[
                    ['Food value (restaurant prices)', rupees(s.restaurantBaseSubtotalPaise)],
                    ['Restaurant-funded discount', neg(s.restaurantFundedDiscountPaise)],
                    ['Packaging', rupees(s.packagingPaise)],
                    ['Commission', neg(s.commissionAmountPaise)],
                    ['Tax on commission', neg(s.commissionTaxPaise)],
                    ['Withholdings (TCS/TDS)', neg(s.restaurantWithholdingPaise)],
                    ['Restaurant payable (estimate)', rupees(s.restaurantPayablePaise), true],
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Platform side (estimate)</CardTitle>
              </CardHeader>
              <CardContent>
                <Rows
                  rows={[
                    ['Markup', rupees(pl.markupPaise)],
                    ['Commission revenue', rupees(pl.commissionRevenuePaise)],
                    ['Platform fee', rupees(pl.platformFeePaise)],
                    ['Delivery fee', rupees(pl.deliveryFeePaise)],
                    ['Rider cost (estimate)', neg(pl.riderCostPaise)],
                    ['Platform-funded discount', neg(pl.platformFundedDiscountPaise)],
                    ['Gateway cost (estimate)', neg(pl.gatewayEstimatePaise)],
                    ['Tax liabilities', neg(pl.taxLiabilitiesPaise)],
                    ['Jamzo net', rupees(pl.netPaise), true],
                  ]}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Frozen at checkout with pricing engine {s.engineVersion}. Tax values are pending CA review
                  (Q-3).
                </p>
              </CardContent>
            </Card>
          </>
        ) : null}
        {o.cancellation ? (
          <Card>
            <CardHeader>
              <CardTitle>Cancellation</CardTitle>
            </CardHeader>
            <CardContent>
              <Rows
                rows={[
                  ['Stage', titleCase(o.cancellation.stage)],
                  [
                    'Cancelled by',
                    ACTOR_LABEL[o.cancellation.cancelledByType] ?? o.cancellation.cancelledByType,
                  ],
                  ['Customer fee', rupees(o.cancellation.customerFeePaise)],
                  ['Refund due', rupees(o.cancellation.refundDuePaise)],
                  ['Restaurant compensation', rupees(o.cancellation.restaurantCompensationPaise)],
                  ['Rider compensation', rupees(o.cancellation.riderCompensationPaise)],
                  ['Platform loss', rupees(o.cancellation.platformLossPaise), true],
                ]}
              />
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">Reason:</span> {titleCase(o.cancellation.reasonCode)}
                {o.cancellation.reasonText ? ` — ${o.cancellation.reasonText}` : ''}
              </p>
              {o.cancellation.isAdminOverride ? (
                <StatusBadge tone="warning" className="mt-2">
                  Amounts overridden by an admin
                </StatusBadge>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2 text-sm">
              {o.history.map((h) => (
                <li
                  key={h.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2 last:border-0"
                >
                  <span>
                    <span className="font-medium">
                      {h.fromStatus === h.toStatus
                        ? titleCase(h.metadata?.event ?? 'Update')
                        : statusLabel(h.toStatus)}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      by {ACTOR_LABEL[h.actorType] ?? h.actorType}
                      {h.reason ? ` — ${h.reason}` : ''}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Internal notes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {o.notes.length ? (
              o.notes.map((n) => (
                <p key={n.id}>
                  {n.body}{' '}
                  <span className="text-xs text-muted-foreground">· {formatDateTime(n.createdAt)}</span>
                </p>
              ))
            ) : (
              <p className="text-muted-foreground">No notes yet.</p>
            )}
            {o.permissions.edit ? (
              <>
                <Label htmlFor="note">Add a note</Label>
                <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                <Button
                  size="sm"
                  className="w-fit"
                  disabled={!note.trim() || addNote.isPending}
                  onClick={() => addNote.mutate()}
                >
                  Add note
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
      {cancelling ? <CancelDialog order={o} onClose={() => setCancelling(false)} /> : null}
      {assigning ? <AssignDialog order={o} onClose={() => setAssigning(false)} /> : null}
      {refunding ? <RefundDialog order={o} onClose={() => setRefunding(false)} /> : null}
      <ConfirmDialog
        open={unassigning}
        onOpenChange={setUnassigning}
        title="Take this order from the partner?"
        description="Dispatch looks for another partner straight away. The reason is recorded."
        confirmLabel="Take order back"
        requireReason
        busy={unassign.isPending}
        onConfirm={(reason) => unassign.mutate(reason)}
      />
    </>
  );
}
