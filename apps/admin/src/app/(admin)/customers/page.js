'use client';

import { useRouter } from 'next/navigation';
import { UserRound } from 'lucide-react';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const columns = [
  {
    header: 'Customer',
    cell: ({ row }) => <span className="font-medium">{row.original.name ?? 'No name yet'}</span>,
  },
  {
    header: 'Phone',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.phoneMasked ?? '—'}</span>,
  },
  {
    header: 'Addresses',
    cell: ({ row }) => <span className="tabular-nums">{row.original.addressCount}</span>,
  },
  { header: 'Joined', cell: ({ row }) => formatDateTime(row.original.createdAt) },
  {
    header: 'Status',
    cell: ({ row }) =>
      row.original.status === 'ACTIVE' ? (
        <StatusBadge tone="success">Active</StatusBadge>
      ) : (
        <StatusBadge tone="critical">{row.original.status}</StatusBadge>
      ),
  },
];

export default function CustomersPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title="Customers"
        description="Contact details are masked. Showing them needs the “customers.pii” permission and is recorded in the audit log."
      />
      <ResourceTable
        queryKey={['customers']}
        fetchPage={(p) => api.get('/v1/admin/customers', p)}
        columns={columns}
        searchPlaceholder="Search by full mobile number or name"
        onRowClick={(c) => router.push(`/customers/${c.id}`)}
        rowLabel={(c) => `Open ${c.name ?? c.phoneMasked}`}
        empty={
          <EmptyState
            icon={UserRound}
            title="No customers found"
            description="Customers appear after their first sign-in to the Jamzo app."
          />
        }
      />
    </>
  );
}
