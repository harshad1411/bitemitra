'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/jamzo/form-field';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';

/** Negative amount for display without a signed zero (−₹0.00). */
const neg = (x) => (x ? -x : 0);

const Rows = ({ rows }) => (
  <Table>
    <TableBody>
      {rows.filter(Boolean).map(([label, paise, strong]) => (
        <TableRow key={label}>
          <TableCell className={strong ? 'font-semibold' : undefined}>{label}</TableCell>
          <TableCell className={`text-right tabular-nums ${strong ? 'font-semibold' : ''}`}>
            {formatPaise(paise)}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/**
 * Prices a sample cart with the live rules and shows every side of the money: what the customer pays,
 * what the restaurant receives, the rider estimate and what remains for Jamzo (PRICING.md §5–§8).
 */
export function QuoteTab() {
  const [restaurantId, setRestaurantId] = useState('');
  const [lat, setLat] = useState('23.805');
  const [lng, setLng] = useState('72.39');
  const [coupon, setCoupon] = useState('');
  const [tip, setTip] = useState('0');
  const [payment, setPayment] = useState('UPI');
  const [lines, setLines] = useState([]);
  const restaurants = useQuery({
    queryKey: ['restaurants', 'options', 'ACTIVE'],
    queryFn: () => api.get('/v1/admin/restaurants', { limit: 100, status: 'ACTIVE' }),
  });
  const menu = useQuery({
    queryKey: ['menu', restaurantId],
    queryFn: () => api.get(`/v1/admin/restaurants/${restaurantId}/menu`),
    enabled: Boolean(restaurantId),
  });
  const products = [
    ...(menu.data?.sections ?? []).flatMap((s) => s.products),
    ...(menu.data?.unsectioned ?? []),
  ].filter((p) => p.status === 'ACTIVE');
  const m = useApiMutation({
    mutationFn: () =>
      api.post('/v1/admin/pricing/quote', {
        restaurantId,
        lat: Number(lat),
        lng: Number(lng),
        couponCode: coupon || undefined,
        tipPaise: Math.round(Number(tip || 0)) * 100,
        paymentMethod: payment,
        lines: lines.map((l, i) => {
          const p = products.find((x) => x.id === l.productId);
          // Required choices (e.g. crust, Jain/regular) take their first option in a test quote.
          const addonIds = (p?.addonGroups ?? []).flatMap((g) =>
            g.addons.length && (g.minSelect ?? 0) > 0
              ? g.addons.slice(0, g.minSelect ?? 1).map((a) => a.id)
              : [],
          );
          return {
            key: `l${i}`,
            productId: l.productId,
            variantId: p?.variants.find((v) => v.isDefault)?.id ?? null,
            addonIds,
            quantity: Number(l.quantity) || 1,
          };
        }),
      }),
  });
  const r = m.data;
  const e = r?.engine;
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Sample cart</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <FormField id="q-restaurant" label="Restaurant">
            <Select value={restaurantId} onValueChange={(v) => (setRestaurantId(v), setLines([]))}>
              <SelectTrigger id="q-restaurant" className="w-full">
                <SelectValue placeholder="Choose a live restaurant" />
              </SelectTrigger>
              <SelectContent>
                {(restaurants.data?.items ?? []).map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-2">
            <FormField id="q-lat" label="Customer latitude">
              {(a) => <Input {...a} value={lat} onChange={(ev) => setLat(ev.target.value)} />}
            </FormField>
            <FormField id="q-lng" label="Customer longitude">
              {(a) => <Input {...a} value={lng} onChange={(ev) => setLng(ev.target.value)} />}
            </FormField>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="flex items-end gap-2">
              <FormField id={`q-item-${i}`} label={`Item ${i + 1}`}>
                <Select
                  value={l.productId}
                  onValueChange={(v) =>
                    setLines((ls) => ls.map((x, j) => (j === i ? { ...x, productId: v } : x)))
                  }
                >
                  <SelectTrigger id={`q-item-${i}`} className="w-48">
                    <SelectValue placeholder="Product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <Input
                aria-label={`Quantity ${i + 1}`}
                className="w-16"
                value={l.quantity}
                onChange={(ev) =>
                  setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: ev.target.value } : x)))
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={!restaurantId}
            onClick={() => setLines((ls) => [...ls, { productId: '', quantity: '1' }])}
          >
            <Plus /> Add item
          </Button>
          <div className="grid grid-cols-3 gap-2">
            <FormField id="q-coupon" label="Coupon">
              {(a) => (
                <Input {...a} value={coupon} onChange={(ev) => setCoupon(ev.target.value.toUpperCase())} />
              )}
            </FormField>
            <FormField id="q-tip" label="Tip (₹)">
              {(a) => (
                <Input {...a} inputMode="numeric" value={tip} onChange={(ev) => setTip(ev.target.value)} />
              )}
            </FormField>
            <FormField id="q-pay" label="Payment">
              <Select value={payment} onValueChange={setPayment}>
                <SelectTrigger id="q-pay" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['UPI', 'CARD', 'NETBANKING', 'WALLET', 'COD'].map((x) => (
                    <SelectItem key={x} value={x}>
                      {x}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <Button
            onClick={() => m.mutate()}
            disabled={!restaurantId || !lines.some((l) => l.productId) || m.isPending}
          >
            {m.isPending ? 'Pricing…' : 'Price this cart'}
          </Button>
        </CardContent>
      </Card>
      <div className="grid content-start gap-4">
        {r?.issues?.length ? (
          <Alert>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {r.issues.map((i, n) => (
                  <li key={n}>{i.message ?? i.code}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {e ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Customer pays</CardTitle>
              </CardHeader>
              <CardContent>
                <Rows
                  rows={[
                    ...r.bill.lines.map((l) => [l.label, l.amountPaise]),
                    ['Total payable', r.bill.totalPayablePaise, true],
                  ]}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Distance {(r.delivery.distanceM / 1000).toFixed(2)} km (
                  {r.delivery.distanceSource === 'FALLBACK'
                    ? 'straight line × factor — no maps provider yet'
                    : 'road'}
                  ). {r.taxNote}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Restaurant receives</CardTitle>
              </CardHeader>
              <CardContent>
                <Rows
                  rows={[
                    ['Food value (restaurant prices)', e.restaurant.foodValuePaise],
                    e.restaurant.restaurantFundedDiscountPaise
                      ? ['Restaurant-funded discounts', neg(e.restaurant.restaurantFundedDiscountPaise)]
                      : null,
                    ['Commission', neg(e.restaurant.commission.amountPaise)],
                    [
                      'Tax on commission',
                      neg(e.restaurant.commissionChargedPaise - e.restaurant.commission.amountPaise),
                    ],
                    ...e.restaurant.withholdings.map((w) => [w.kind, neg(w.amountPaise)]),
                    e.restaurant.packagingPaise
                      ? ['Packaging (passed through)', e.restaurant.packagingPaise]
                      : null,
                    e.restaurant.roundingAbsorbedPaise
                      ? ['Rounding', e.restaurant.roundingAbsorbedPaise]
                      : null,
                    ['Restaurant payable', e.restaurant.payablePaise, true],
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Where the money goes</CardTitle>
              </CardHeader>
              <CardContent>
                <Rows
                  rows={[
                    ['Restaurant', e.restaurant.payablePaise],
                    ['Delivery partner (estimate)', e.rider.totalPaise],
                    e.totals.tipPaise ? ['Tip (to the delivery partner)', e.totals.tipPaise] : null,
                    ['Taxes (liability, not revenue)', e.platform.taxLiabilitiesPaise],
                    e.platform.withholdingPaise ? ['Withholdings', e.platform.withholdingPaise] : null,
                    ['Payment gateway (estimate)', e.platform.gatewayEstimatePaise],
                    ['Jamzo net', e.platform.netPaise, true],
                  ]}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  These add up to exactly the total payable — every quote is checked (PRICING.md §8).
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Jamzo net, by component</CardTitle>
              </CardHeader>
              <CardContent>
                <Rows
                  rows={[
                    ['Markup', e.platform.markupPaise],
                    ['Commission (after its tax)', e.platform.commissionRevenuePaise],
                    ['Delivery fee', e.platform.deliveryFeePaise],
                    e.platform.surchargePaise ? ['Surcharges', e.platform.surchargePaise] : null,
                    e.platform.smallOrderFeePaise ? ['Small-order fee', e.platform.smallOrderFeePaise] : null,
                    ['Platform fee', e.platform.platformFeePaise],
                    ['Delivery partner cost', neg(e.platform.riderCostPaise)],
                    e.platform.platformFundedDiscountPaise
                      ? ['Jamzo-funded discounts', neg(e.platform.platformFundedDiscountPaise)]
                      : null,
                    e.platform.roundingPaise ? ['Rounding', e.platform.roundingPaise] : null,
                    ['Gateway', neg(e.platform.gatewayEstimatePaise)],
                    e.taxes.inclusiveTotalPaise
                      ? ['Taxes included in prices', neg(e.taxes.inclusiveTotalPaise)]
                      : null,
                    ['Jamzo net', e.platform.netPaise, true],
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        ) : !r ? (
          <p className="text-sm text-muted-foreground">
            Choose a restaurant and items, then price the cart. The same engine prices the customer app’s
            cart.
          </p>
        ) : null}
      </div>
    </div>
  );
}
