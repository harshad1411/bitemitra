'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { RunDialog } from '@/components/settlements/run-dialog';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SETTLEMENT_STATUS, dateOnly } from '@/lib/settlements';

const period = (s) =>
  `${dateOnly(s.periodStart)} – ${dateOnly(new Date(new Date(s.periodEnd).getTime() - 1))}`;

export default function SettlementsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const [kind, setKind] = useState('RESTAURANT');
  const [status, setStatus] = useState('ALL');
  const [running, setRunning] = useState(false);
  const columns = [
    {
      header: kind === 'RESTAURANT' ? 'Restaurant' : 'Delivery partner',
      cell: ({ row }) => row.original.name,
    },
    { header: 'Period', cell: ({ row }) => period(row.original) },
    {
      header: 'Status',
      cell: ({ row }) => {
        const [label, tone] = SETTLEMENT_STATUS[row.original.status] ?? [row.original.status, 'neutral'];
        return <StatusBadge tone={tone}>{label}</StatusBadge>;
      },
    },
    ...(kind === 'RESTAURANT'
      ? [
          {
            header: 'Food sales',
            cell: ({ row }) => (
              <span className="tabular-nums">{formatPaise(row.original.grossSalesPaise)}</span>
            ),
          },
          {
            header: 'Commission',
            cell: ({ row }) => (
              <span className="tabular-nums">{formatPaise(row.original.commissionPaise)}</span>
            ),
          },
        ]
      : [
          {
            header: 'Earnings',
            cell: ({ row }) => (
              <span className="tabular-nums">{formatPaise(row.original.earningsPaise)}</span>
            ),
          },
          {
            header: 'Cash netted',
            cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.codOwedPaise)}</span>,
          },
        ]),
    {
      header: 'To pay',
      cell: ({ row }) => (
        <span className="font-medium tabular-nums">{formatPaise(row.original.netPayablePaise)}</span>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Settlements"
        description="What Jamzo owes restaurants and delivery partners, period by period. Jamzo records payouts; it does not make them."
        actions={
          can('settlements.manage') ? <Button onClick={() => setRunning(true)}>Run settlements</Button> : null
        }
      />
      <Tabs value={kind} onValueChange={setKind} className="mb-4">
        <TabsList>
          <TabsTrigger value="RESTAURANT">Restaurants</TabsTrigger>
          <TabsTrigger value="RIDER">Delivery partners</TabsTrigger>
        </TabsList>
      </Tabs>
      <ResourceTable
        key={kind}
        queryKey={['settlements', kind]}
        fetchPage={(p) => api.get('/v1/admin/settlements', { ...p, kind })}
        columns={columns}
        filters={status === 'ALL' ? {} : { status }}
        searchPlaceholder={kind === 'RESTAURANT' ? 'Restaurant name' : 'Partner name'}
        toolbar={
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-52" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {Object.entries(SETTLEMENT_STATUS).map(([v, [l]]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        onRowClick={(r) => router.push(`/settlements/${kind.toLowerCase()}/${r.id}`)}
        rowLabel={(r) => `Open settlement for ${r.name}`}
        empty={
          <EmptyState
            icon={Wallet}
            title="No settlements"
            description="Settlements are created each morning by schedule, or with Run settlements."
          />
        }
      />
      {running ? <RunDialog kind={kind} onClose={() => setRunning(false)} /> : null}
    </>
  );
}
