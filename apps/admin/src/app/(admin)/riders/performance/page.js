'use client';

// Delivery partner performance (D-113): one row per partner for a date range, with totals. Partner pay is
// what they earned for trips; Jamzo margin = delivery charges customers paid − partner pay (tips excluded).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/jamzo/page-header';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { FIGURES, RangePicker, hours, money, presetRange, stars } from '@/components/riders/performance';
import { api } from '@/lib/api';
import { VEHICLE } from '@/lib/riders';

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

export default function RiderPerformancePage() {
  const router = useRouter();
  const [preset, setPreset] = useState('TODAY');
  const [range, setRange] = useState(() => presetRange('TODAY'));
  const q = useQuery({
    queryKey: ['rider-performance', range],
    queryFn: () => api.get('/v1/admin/riders/performance', range),
  });
  const t = q.data?.totals;
  return (
    <>
      <PageHeader
        back={{ href: '/riders', label: 'Delivery partners' }}
        title="Partner performance"
        description="Deliveries, pay and what Jamzo earned on delivery, per partner. Jamzo margin = delivery charges customers paid − partner pay (tips always go to the partner)."
      />
      <div className="mb-4">
        <RangePicker
          preset={preset}
          range={range}
          onChange={(p, r) => {
            setPreset(p);
            setRange(r);
          }}
        />
      </div>
      {q.isPending ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Deliveries" value={t.deliveries} hint={`${t.cancelledTrips} cancelled trips paid`} />
            <Kpi label="Partner pay" value={money(t.payPaise)} hint={`+ ${money(t.tipsPaise)} tips`} />
            <Kpi
              label="Jamzo delivery margin"
              value={money(t.marginPaise)}
              hint={`from ${money(t.deliveryChargesPaise)} delivery charges`}
            />
            <Kpi
              label="Cash collected"
              value={money(t.cashCollectedPaise)}
              hint={`Online ${hours(t.onlineMinutes)} · rating ${stars(t.rating)}`}
            />
          </div>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    {FIGURES.map(([h]) => (
                      <TableHead key={h} className="text-right">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data.items.length ? (
                    q.data.items.map((r) => (
                      <TableRow
                        key={r.rider.id}
                        className="cursor-pointer"
                        aria-label={`Open ${r.rider.name ?? 'partner'}`}
                        onClick={() => router.push(`/riders/${r.rider.id}`)}
                      >
                        <TableCell>
                          <div className="font-medium">{r.rider.name ?? '—'}</div>
                          <div className="text-xs text-muted-foreground">
                            {[VEHICLE[r.rider.vehicle] ?? r.rider.vehicle, r.rider.phoneMasked]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </TableCell>
                        {FIGURES.map(([h, f]) => (
                          <TableCell key={h} className="text-right tabular-nums">
                            {f(r)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={FIGURES.length + 1} className="text-center text-muted-foreground">
                        No active delivery partners yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
