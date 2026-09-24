'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PageHeader } from '@/components/jamzo/page-header';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, titleCase } from '@/lib/format';

function Stat({ label, value, href, sub }) {
  const body = (
    <Card className="gap-1 py-4 transition-colors hover:bg-accent/40">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const breakdown = (o) =>
  Object.entries(o ?? {})
    .map(([k, v]) => `${v} ${titleCase(k)}`)
    .join(' · ') || 'None yet';

export default function DashboardPage() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get('/v1/admin/dashboard') });
  return (
    <>
      <PageHeader
        title={`Welcome${me?.user?.name ? `, ${me.user.name}` : ''}`}
        description="Platform setup at a glance."
      />
      <Alert className="mb-6">
        <Info />
        <AlertTitle>Operations alerts are not available yet</AlertTitle>
        <AlertDescription>
          {q.data?.operations?.message ?? 'Order and delivery alerts become available in Phase 5.'}
        </AlertDescription>
      </Alert>
      {q.isPending ? (
        <LoadingRows rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Cities"
              value={q.data.setup.cities.total}
              sub={`${q.data.setup.cities.live} live`}
              href="/cities"
            />
            <Stat label="Zones" value={q.data.setup.zones} href="/cities" />
            <Stat
              label="Restaurants"
              value={sum(q.data.setup.restaurants)}
              sub={breakdown(q.data.setup.restaurants)}
            />
            <Stat
              label="Delivery partners"
              value={sum(q.data.setup.deliveryPartners)}
              sub={breakdown(q.data.setup.deliveryPartners)}
            />
            <Stat label="Customers" value={q.data.setup.customers} />
            <Stat label="Active admins" value={q.data.setup.activeAdmins} href="/users" />
            <Stat label="Media" value={q.data.setup.media} href="/media" />
          </div>
          {q.data.recentActivity ? (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle className="text-base">Recent activity</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {q.data.recentActivity.map((a) => (
                    <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                      <span className="font-mono text-xs">{a.action}</span>
                      <span className="text-muted-foreground">{formatDateTime(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/audit" className="mt-3 inline-block text-sm text-primary hover:underline">
                  Open audit log
                </Link>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
