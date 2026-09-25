'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatPaise } from '@jamzo/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/jamzo/form-field';
import { PageHeader } from '@/components/jamzo/page-header';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';

const iso = (d) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10); // India date
const BY = {
  NONE: 'No breakdown',
  CITY: 'City',
  ZONE: 'Zone',
  RESTAURANT: 'Restaurant',
  PAYMENT_METHOD: 'Payment method',
};
const mins = (m) => (m == null ? '—' : `${m} min`);

function Kpi({ label, value, hint }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getTime() - 6 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date(now.getTime() + 86_400_000)));
  const [by, setBy] = useState('NONE');
  const q = useQuery({
    queryKey: ['analytics', from, to, by],
    queryFn: () => api.get('/v1/admin/analytics', { from, to, by }),
    enabled: Boolean(from && to && from < to),
  });
  const t = q.data?.totals;
  return (
    <>
      <PageHeader
        title="Analytics"
        description="Orders placed in the period, computed when you open this page (refreshed at most once a minute)."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField id="an-from" label="From">
          {(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </FormField>
        <FormField id="an-to" label="Until, not included">
          {(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
        </FormField>
        <Select value={by} onValueChange={setBy}>
          <SelectTrigger className="w-48" aria-label="Breakdown">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(BY).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {q.isPending ? (
        <LoadingRows rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Orders"
              value={t.orders}
              hint={`${t.completed} delivered · ${t.cancelled} cancelled`}
            />
            <Kpi
              label="GMV (delivered)"
              value={formatPaise(t.gmvPaise)}
              hint={`Average order ${t.averageOrderValuePaise == null ? '—' : formatPaise(t.averageOrderValuePaise)}`}
            />
            <Kpi
              label="Net for Jamzo"
              value={formatPaise(t.netPlatformRevenuePaise)}
              hint={`Refunds ${formatPaise(t.refundsPaise)}`}
            />
            <Kpi
              label="Delivery time"
              value={mins(t.averageDeliveryMinutes)}
              hint={`Kitchen time ${mins(t.averagePrepMinutes)}`}
            />
            <Kpi label="Live restaurants" value={t.liveRestaurants} />
            <Kpi label="Delivery partners" value={t.activeRiders} hint={`${t.onlineRidersNow} online now`} />
          </div>
          {q.data.breakdown.length ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>By {BY[by].toLowerCase()}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{BY[by]}</TableHead>
                      <TableHead className="text-right">Orders</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">Cancelled</TableHead>
                      <TableHead className="text-right">GMV</TableHead>
                      <TableHead className="text-right">Net for Jamzo</TableHead>
                      <TableHead className="text-right">Delivery time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data.breakdown.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell>{r.label}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.orders}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.completed}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.cancelled}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPaise(r.gmvPaise)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPaise(r.netPlatformRevenuePaise)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {mins(r.averageDeliveryMinutes)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">{q.data.note}</p>
        </>
      )}
    </>
  );
}
