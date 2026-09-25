'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/jamzo/form-field';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { parsePercentToBps, summarize } from '@/lib/pricing';

const Rule = ({ label, rule, type }) => (
  <div className="flex flex-col gap-0.5 border-b py-2 last:border-0 sm:flex-row sm:justify-between">
    <span className="text-sm font-medium">{label}</span>
    <span className="text-sm text-muted-foreground">
      {rule ? (
        <>
          {summarize(type, rule.params)}{' '}
          <StatusBadge>
            {rule.inheritedFrom === 'GLOBAL' ? 'all cities' : rule.inheritedFrom.toLowerCase()}
          </StatusBadge>
        </>
      ) : (
        'No rule'
      )}
    </span>
  </div>
);

/** Which pricing rules apply to this restaurant, and what a markup change would do to its menu (§9). */
export function RestaurantPricingTab({ restaurant }) {
  const eff = useQuery({
    queryKey: ['pricing', 'effective', restaurant.id],
    queryFn: () => api.get('/v1/admin/pricing/effective', { restaurantId: restaurant.id }),
  });
  const [draft, setDraft] = useState('');
  const preview = useApiMutation({
    mutationFn: () => {
      const bps = parsePercentToBps(draft);
      return api.post('/v1/admin/pricing/preview', {
        restaurantId: restaurant.id,
        ...(bps != null
          ? {
              draft: {
                type: 'MARKUP',
                scope: 'RESTAURANT',
                scopeRefId: restaurant.id,
                params: {
                  type: 'PERCENTAGE',
                  valueBps: bps,
                  rounding: { mode: 'NEAREST_1', direction: 'HALF_UP' },
                },
              },
            }
          : {}),
      });
    },
  });
  if (eff.isPending) return <LoadingRows />;
  if (eff.isError) return <ErrorState error={eff.error} onRetry={() => eff.refetch()} />;
  const e = eff.data;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Rules in force</CardTitle>
          <CardDescription>
            {e.note} Change rules on the{' '}
            <Link className="underline" href="/pricing">
              Pricing
            </Link>{' '}
            page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Rule label="Markup" rule={e.markup} type="MARKUP" />
          <Rule label="Commission" rule={e.commission} type="COMMISSION" />
          <Rule label="Food tax" rule={e.tax.FOOD} type="TAX" />
          <Rule label="Delivery fee" rule={e.delivery} type="DELIVERY" />
          <Rule label="Platform fee" rule={e.platformFee} type="PLATFORM_FEE" />
          <Rule label="Night surcharge" rule={e.surge.NIGHT} type="SURGE" />
          <Rule label="Rider pay" rule={e.riderEarning} type="RIDER_EARNING" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Menu price preview</CardTitle>
          <CardDescription>
            Per item, before discounts, packaging and taxes. Optionally try a restaurant-level markup before
            saving it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex items-end gap-2">
            <FormField id="pv-markup" label="Try markup (%) — optional">
              {(a) => (
                <Input {...a} className="w-32" value={draft} onChange={(ev) => setDraft(ev.target.value)} />
              )}
            </FormField>
            <Button onClick={() => preview.mutate()} disabled={preview.isPending}>
              {preview.isPending ? 'Calculating…' : 'Preview'}
            </Button>
          </div>
          {preview.data ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Restaurant price</TableHead>
                    <TableHead className="text-right">Customer price</TableHead>
                    {preview.data.items[0]?.draft ? (
                      <TableHead className="text-right">With draft</TableHead>
                    ) : null}
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Restaurant net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.data.items.map((i) => (
                    <TableRow key={i.productId}>
                      <TableCell>{i.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPaise(i.restaurantPricePaise)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPaise(i.current.customerPricePaise)}
                      </TableCell>
                      {i.draft ? (
                        <TableCell className="text-right tabular-nums">
                          {formatPaise(i.draft.customerPricePaise)}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right tabular-nums">
                        {formatPaise(i.current.commissionPaise)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPaise(i.current.restaurantNetPaise)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
