'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LifeBuoy } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ISSUE, TICKET_STATUS } from '@/lib/support';

const QUEUES = {
  ACTIVE: 'OPEN,IN_PROGRESS',
  WAITING: 'WAITING_ON_CUSTOMER',
  DONE: 'RESOLVED,CLOSED',
};
const columns = [
  {
    header: 'Ticket',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.ticketNumber}</span>,
  },
  { header: 'Issue', cell: ({ row }) => ISSUE[row.original.issueType] },
  {
    header: 'Order',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.orderNumber ?? '—'}</span>,
  },
  { header: 'Customer', cell: ({ row }) => row.original.customerName ?? '—' },
  {
    header: 'Status',
    cell: ({ row }) => {
      const [label, tone] = TICKET_STATUS[row.original.status];
      return <StatusBadge tone={tone}>{label}</StatusBadge>;
    },
  },
  {
    header: 'Owner',
    cell: ({ row }) =>
      row.original.assignedToMe ? 'You' : row.original.assignedToId ? 'Someone else' : 'Nobody yet',
  },
  {
    header: 'Last message',
    cell: ({ row }) => formatDateTime(row.original.lastMessageAt ?? row.original.createdAt),
  },
];

export default function SupportPage() {
  const router = useRouter();
  const [queue, setQueue] = useState('ACTIVE');
  const [mine, setMine] = useState('ALL');
  return (
    <>
      <PageHeader
        title="Support"
        description="Customer questions with the whole order at hand. Customers never see internal notes."
      />
      <Tabs value={queue} onValueChange={setQueue} className="mb-4">
        <TabsList>
          <TabsTrigger value="ACTIVE">To answer</TabsTrigger>
          <TabsTrigger value="WAITING">Waiting for customer</TabsTrigger>
          <TabsTrigger value="DONE">Resolved</TabsTrigger>
        </TabsList>
      </Tabs>
      <ResourceTable
        key={queue}
        queryKey={['support', queue]}
        fetchPage={(p) => api.get('/v1/admin/support/tickets', p)}
        columns={columns}
        filters={{ status: QUEUES[queue], ...(mine === 'MINE' ? { mine: 'true' } : {}) }}
        refetchInterval={30_000}
        searchPlaceholder="Ticket, order number or customer name"
        toolbar={
          <Select value={mine} onValueChange={setMine}>
            <SelectTrigger className="w-40" aria-label="Owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Everyone&apos;s</SelectItem>
              <SelectItem value="MINE">Mine</SelectItem>
            </SelectContent>
          </Select>
        }
        onRowClick={(t) => router.push(`/support/${t.id}`)}
        rowLabel={(t) => `Open ticket ${t.ticketNumber}`}
        empty={
          <EmptyState
            icon={LifeBuoy}
            title="Nothing here"
            description="Customer questions appear here as they arrive."
          />
        }
      />
    </>
  );
}
