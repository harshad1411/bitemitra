'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, TicketPercent } from 'lucide-react';
import { formatPaise, paiseToRupeeInput, parseRupeesToPaise } from '@jamzo/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/jamzo/page-header';
import { FormField } from '@/components/jamzo/form-field';
import { PriceInput } from '@/components/jamzo/price-input';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState, ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { bpsToPercentText, parsePercentToBps, pct } from '@/lib/pricing';

const STATUS_TONE = { ACTIVE: 'success', SCHEDULED: 'info', ENDED: 'neutral', PAUSED: 'warning' };
const money = (p) => (p == null ? '' : paiseToRupeeInput(p));
/** datetime-local value for an ISO date in the admin's timezone. */
const localInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function describe(o) {
  const v =
    o.discountType === 'FREE_DELIVERY'
      ? 'Free delivery'
      : o.discountType === 'PERCENTAGE'
        ? `${pct(o.valueBps)} off${o.maxDiscountPaise ? ` up to ${formatPaise(o.maxDiscountPaise)}` : ''}`
        : `${formatPaise(o.valuePaise)} off`;
  const min = o.minOrderPaise ? ` · min ${formatPaise(o.minOrderPaise)}` : '';
  const who = {
    PLATFORM: 'Jamzo pays',
    RESTAURANT: 'restaurant pays',
    SHARED: `shared (restaurant ${pct(o.restaurantShareBps ?? 0)})`,
  }[o.fundingSource];
  return `${v}${min} · ${who}`;
}

function OfferDialog({ kind, offer, onClose }) {
  const isCoupon = kind === 'coupons';
  const restaurants = useQuery({
    queryKey: ['restaurants', 'options'],
    queryFn: () => api.get('/v1/admin/restaurants', { limit: 100 }),
  });
  const [f, setF] = useState({
    code: offer?.code ?? '',
    name: offer?.name ?? '',
    description: offer?.description ?? '',
    discountType: offer?.discountType ?? 'PERCENTAGE',
    value: offer
      ? offer.discountType === 'PERCENTAGE'
        ? bpsToPercentText(offer.valueBps)
        : money(offer.valuePaise)
      : '',
    max: money(offer?.maxDiscountPaise),
    min: money(offer?.minOrderPaise),
    fundingSource: offer?.fundingSource ?? (isCoupon ? 'PLATFORM' : 'RESTAURANT'),
    share: bpsToPercentText(offer?.restaurantShareBps ?? 5000),
    restaurantId: offer?.targeting?.restaurantIds?.[0] ?? 'ALL',
    firstOrderOnly: offer?.firstOrderOnly ?? false,
    perUserLimit: offer?.perUserLimit ? String(offer.perUserLimit) : '',
    usageLimit: offer?.usageLimit ? String(offer.usageLimit) : '',
    startsAt: localInput(offer?.startsAt ?? new Date().toISOString()),
    endsAt: localInput(offer?.endsAt),
    isActive: offer?.isActive ?? true,
  });
  const [local, setLocal] = useState([]);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const m = useApiMutation({
    mutationFn: (body) =>
      offer ? api.patch(`/v1/admin/${kind}/${offer.id}`, body) : api.post(`/v1/admin/${kind}`, body),
    invalidate: [[kind]],
    success: isCoupon ? 'Coupon saved' : 'Promotion saved',
    onSuccess: onClose,
  });
  const submit = () => {
    const errors = [];
    const rs = (v, label, required) => {
      if (!v) return required ? (errors.push(`${label}: required`), null) : null;
      const x = parseRupeesToPaise(v);
      if (x == null) errors.push(`${label}: use an amount like 50 or 49.50`);
      return x;
    };
    const valueBps = f.discountType === 'PERCENTAGE' ? parsePercentToBps(f.value) : null;
    if (f.discountType === 'PERCENTAGE' && valueBps == null)
      errors.push('Percentage: use a value like 10 or 12.5');
    const body = {
      ...(isCoupon
        ? {
            code: f.code,
            description: f.description || null,
            firstOrderOnly: f.firstOrderOnly,
            perUserLimit: f.perUserLimit ? Number(f.perUserLimit) : null,
            usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
          }
        : { name: f.name }),
      discountType: f.discountType,
      valueBps,
      valuePaise: f.discountType === 'FIXED' ? rs(f.value, 'Amount', true) : null,
      maxDiscountPaise: f.discountType === 'PERCENTAGE' ? rs(f.max, 'Maximum discount', false) : null,
      minOrderPaise: rs(f.min, 'Minimum order', false),
      fundingSource: f.fundingSource,
      restaurantShareBps: f.fundingSource === 'SHARED' ? parsePercentToBps(f.share) : null,
      targeting: f.restaurantId === 'ALL' ? {} : { restaurantIds: [f.restaurantId] },
      startsAt: new Date(f.startsAt).toISOString(),
      endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
      isActive: f.isActive,
    };
    setLocal(errors);
    if (!errors.length) m.mutate(body);
  };
  const e = m.fieldErrors;
  const choose = (id, label, key, options) => (
    <FormField id={id} label={label} errors={e[key]}>
      <Select value={f[key]} onValueChange={set(key)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {offer ? `Edit ${offer.code ?? offer.name}` : isCoupon ? 'New coupon' : 'New promotion'}
          </DialogTitle>
          <DialogDescription>
            {isCoupon
              ? 'Customers enter the code in the cart.'
              : 'Applied automatically when the cart qualifies (the best promotion wins).'}{' '}
            Per-customer, usage and first-order limits are enforced at checkout.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {isCoupon ? (
            <FormField
              id="o-code"
              label="Code"
              errors={e.code}
              help={offer ? 'Codes cannot change.' : '3–20 letters or digits.'}
            >
              {(a) => (
                <Input
                  {...a}
                  value={f.code}
                  disabled={Boolean(offer)}
                  onChange={(ev) => set('code')(ev.target.value.toUpperCase())}
                />
              )}
            </FormField>
          ) : (
            <FormField id="o-name" label="Name" errors={e.name}>
              {(a) => <Input {...a} value={f.name} onChange={set('name')} />}
            </FormField>
          )}
          {choose('o-type', 'Discount', 'discountType', [
            ['PERCENTAGE', 'Percentage'],
            ['FIXED', 'Fixed amount'],
            ['FREE_DELIVERY', 'Free delivery'],
          ])}
          {f.discountType === 'PERCENTAGE' ? (
            <>
              <FormField id="o-value" label="Percentage" errors={e.valueBps}>
                {(a) => <Input {...a} value={f.value} onChange={set('value')} />}
              </FormField>
              <FormField id="o-max" label="Maximum discount (optional)" errors={e.maxDiscountPaise}>
                {(a) => <PriceInput {...a} value={f.max} onChange={set('max')} />}
              </FormField>
            </>
          ) : f.discountType === 'FIXED' ? (
            <FormField id="o-value" label="Amount" errors={e.valuePaise}>
              {(a) => <PriceInput {...a} value={f.value} onChange={set('value')} />}
            </FormField>
          ) : null}
          <FormField id="o-min" label="Minimum order (optional)" errors={e.minOrderPaise}>
            {(a) => <PriceInput {...a} value={f.min} onChange={set('min')} />}
          </FormField>
          {choose('o-funding', 'Who pays for it', 'fundingSource', [
            ['PLATFORM', 'Jamzo'],
            ['RESTAURANT', 'The restaurant'],
            ['SHARED', 'Shared'],
          ])}
          {f.fundingSource === 'SHARED' ? (
            <FormField id="o-share" label="Restaurant’s share (%)" errors={e.restaurantShareBps}>
              {(a) => <Input {...a} value={f.share} onChange={set('share')} />}
            </FormField>
          ) : null}
          {choose('o-restaurant', 'Restaurant', 'restaurantId', [
            ['ALL', 'All restaurants'],
            ...(restaurants.data?.items ?? []).map((r) => [r.id, r.name]),
          ])}
          <FormField id="o-starts" label="Starts" errors={e.startsAt}>
            {(a) => <Input {...a} type="datetime-local" value={f.startsAt} onChange={set('startsAt')} />}
          </FormField>
          <FormField id="o-ends" label="Ends (optional)" errors={e.endsAt}>
            {(a) => <Input {...a} type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />}
          </FormField>
          {isCoupon ? (
            <>
              <FormField id="o-per-user" label="Uses per customer (optional)">
                {(a) => (
                  <Input {...a} inputMode="numeric" value={f.perUserLimit} onChange={set('perUserLimit')} />
                )}
              </FormField>
              <FormField id="o-usage" label="Total uses (optional)">
                {(a) => (
                  <Input {...a} inputMode="numeric" value={f.usageLimit} onChange={set('usageLimit')} />
                )}
              </FormField>
              <div className="flex items-center gap-2">
                <Switch id="o-first" checked={f.firstOrderOnly} onCheckedChange={set('firstOrderOnly')} />
                <Label htmlFor="o-first">First order only</Label>
              </div>
            </>
          ) : null}
          <div className="flex items-center gap-2">
            <Switch id="o-active" checked={f.isActive} onCheckedChange={set('isActive')} />
            <Label htmlFor="o-active">Active</Label>
          </div>
        </div>
        {local.length ? (
          <Alert variant="destructive">
            <AlertDescription>{local.join(' ')}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OffersTable({ kind }) {
  const [dialog, setDialog] = useState(null);
  const q = useQuery({ queryKey: [kind], queryFn: () => api.get(`/v1/admin/${kind}`) });
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setDialog({})}>
          <Plus /> {kind === 'coupons' ? 'New coupon' : 'New promotion'}
        </Button>
      </div>
      <Card className="overflow-hidden py-0">
        {q.isPending ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState
            icon={TicketPercent}
            title={kind === 'coupons' ? 'No coupons yet' : 'No promotions yet'}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{kind === 'coupons' ? 'Code' : 'Promotion'}</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.items.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.code ?? o.name}</TableCell>
                    <TableCell className="text-sm">{describe(o)}</TableCell>
                    <TableCell className="text-xs">
                      {formatDateTime(o.startsAt)} → {o.endsAt ? formatDateTime(o.endsAt) : 'no end'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={STATUS_TONE[o.status]}>
                        {o.status.charAt(0) + o.status.slice(1).toLowerCase()}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" onClick={() => setDialog({ offer: o })}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      {dialog ? <OfferDialog kind={kind} offer={dialog.offer} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

export default function OffersPage() {
  return (
    <>
      <PageHeader
        title="Offers & coupons"
        description="Discounts with a clear funding source. Every order will record who paid for each discount."
      />
      <Tabs defaultValue="coupons">
        <TabsList className="mb-4">
          <TabsTrigger value="coupons">Coupons</TabsTrigger>
          <TabsTrigger value="promotions">Automatic promotions</TabsTrigger>
        </TabsList>
        <TabsContent value="coupons">
          <OffersTable kind="coupons" />
        </TabsContent>
        <TabsContent value="promotions">
          <OffersTable kind="promotions" />
        </TabsContent>
      </Tabs>
    </>
  );
}
