'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatPaise } from '@jamzo/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/jamzo/form-field';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { PLATFORM_TYPE } from '@/lib/settlements';

const iso = (d) => d.toISOString().slice(0, 10);

export default function FinancePage() {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 7 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date(today.getTime() + 86_400_000)));
  const valid = from && to && from < to;
  const platform = useQuery({
    queryKey: ['finance-platform', from, to],
    queryFn: () => api.get('/v1/admin/finance/platform', { from, to }),
    enabled: Boolean(valid),
  });
  const checks = useQuery({
    queryKey: ['finance-checks', from, to],
    queryFn: () => api.get('/v1/admin/finance/checks', { from, to }),
    enabled: Boolean(valid),
  });
  return (
    <>
      <PageHeader
        title="Finance"
        description="Jamzo's own ledger for a period, and the checks that every delivered order adds up and every balance matches its entries."
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <FormField id="fin-from" label="From">
          {(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}
        </FormField>
        <FormField id="fin-to" label="Until, not included">
          {(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}
        </FormField>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Jamzo&apos;s ledger</CardTitle>
          </CardHeader>
          <CardContent>
            {platform.isPending ? (
              <LoadingRows rows={4} />
            ) : platform.isError ? (
              <ErrorState error={platform.error} onRetry={() => platform.refetch()} />
            ) : (
              <Table>
                <TableBody>
                  {platform.data.lines
                    .filter((l) => !l.liability)
                    .map((l) => (
                      <TableRow key={`${l.type}-${l.direction}`}>
                        <TableCell>{PLATFORM_TYPE[l.type] ?? l.type}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPaise((l.direction === 'CREDIT' ? 1 : -1) * l.amountPaise)}
                        </TableCell>
                      </TableRow>
                    ))}
                  <TableRow>
                    <TableCell className="font-semibold">Net for Jamzo</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatPaise(platform.data.netPaise)}
                    </TableCell>
                  </TableRow>
                  {platform.data.lines
                    .filter((l) => l.liability)
                    .map((l) => (
                      <TableRow key={l.type}>
                        <TableCell className="text-muted-foreground">
                          {PLATFORM_TYPE[l.type] ?? l.type} (not revenue)
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {formatPaise(l.amountPaise)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Tax treatment is provisional until the CA confirms it (Q-3).
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Checks</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {checks.isPending ? (
              <LoadingRows rows={3} />
            ) : checks.isError ? (
              <ErrorState error={checks.error} onRetry={() => checks.refetch()} />
            ) : (
              <>
                <p>
                  <StatusBadge tone={checks.data.orders.problems.length ? 'critical' : 'success'}>
                    {`${checks.data.orders.ok} of ${checks.data.orders.checked} delivered orders add up`}
                  </StatusBadge>
                </p>
                {checks.data.orders.problems.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead>Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {checks.data.orders.problems.map((p) => (
                        <TableRow key={p.orderId}>
                          <TableCell className="font-mono text-xs">
                            <Link href={`/orders/${p.orderId}`}>{p.orderNumber}</Link>
                          </TableCell>
                          <TableCell>
                            {p.status === 'NOT_POSTED'
                              ? 'Not posted yet (the worker posts within seconds)'
                              : `Off by ${formatPaise(p.differencePaise)}`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
                <p>
                  <StatusBadge tone={checks.data.balances.drift.length ? 'critical' : 'success'}>
                    {checks.data.balances.drift.length
                      ? `${checks.data.balances.drift.length} balances do not match their entries`
                      : 'Every balance matches its entries'}
                  </StatusBadge>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
