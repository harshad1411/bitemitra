'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bike } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { RIDER_STATUS, VEHICLE } from '@/lib/riders';

const columns = [
  { header: 'Name', cell: ({ row }) => <span className="font-medium">{row.original.name ?? '—'}</span> },
  {
    header: 'Phone',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.phoneMasked ?? '—'}</span>,
  },
  {
    header: 'Status',
    cell: ({ row }) => {
      const [label, tone] = RIDER_STATUS[row.original.onboardingStatus] ?? [
        row.original.onboardingStatus,
        'neutral',
      ];
      return <StatusBadge tone={tone}>{label}</StatusBadge>;
    },
  },
  { header: 'Vehicle', cell: ({ row }) => VEHICLE[row.original.vehicle] ?? '—' },
  {
    header: 'Online',
    cell: ({ row }) =>
      row.original.online ? (
        <StatusBadge tone="success">Online</StatusBadge>
      ) : (
        <span className="text-muted-foreground">Offline</span>
      ),
  },
  {
    header: 'Active orders',
    cell: ({ row }) => <span className="tabular-nums">{row.original.activeOrderCount}</span>,
  },
  {
    header: 'Cash in hand',
    cell: ({ row }) => <span className="tabular-nums">{formatPaise(row.original.codBalancePaise)}</span>,
  },
  { header: 'Joined', cell: ({ row }) => formatDateTime(row.original.createdAt) },
];

export default function RidersPage() {
  const router = useRouter();
  const [status, setStatus] = useState('ALL');
  const [online, setOnline] = useState('ALL');
  const filters = { ...(status === 'ALL' ? {} : { status }), ...(online === 'ALL' ? {} : { online }) };
  return (
    <>
      <PageHeader
        title="Delivery partners"
        description="Applications, documents, status and cash limits. Document files are private; every view is recorded."
      />
      <ResourceTable
        queryKey={['riders']}
        fetchPage={(p) => api.get('/v1/admin/riders', p)}
        columns={columns}
        filters={filters}
        refetchInterval={30_000}
        searchPlaceholder="Search by name"
        toolbar={
          <div className="flex flex-wrap gap-2">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-48" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {Object.entries(RIDER_STATUS).map(([v, [l]]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={online} onValueChange={setOnline}>
              <SelectTrigger className="w-36" aria-label="Online">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Online or not</SelectItem>
                <SelectItem value="true">Online</SelectItem>
                <SelectItem value="false">Offline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        onRowClick={(r) => router.push(`/riders/${r.id}`)}
        rowLabel={(r) => `Open ${r.name ?? 'delivery partner'}`}
        empty={
          <EmptyState
            icon={Bike}
            title="No delivery partners"
            description="Partners appear when they apply in the Delivery Partner app."
          />
        }
      />
    </>
  );
}
