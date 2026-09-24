'use client';

import { ResourceTable } from '@/components/jamzo/resource-table';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { renderValue } from './value-editor';

const columns = [
  {
    header: 'When',
    cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.changedAt)}</span>,
  },
  { header: 'Setting', cell: ({ row }) => <span className="font-mono text-xs">{row.original.key}</span> },
  {
    header: 'Scope',
    cell: ({ row }) =>
      `${row.original.scope}${row.original.scopeRefId ? ` · ${row.original.scopeRefId.slice(0, 8)}…` : ''}`,
  },
  { header: 'Previous', cell: ({ row }) => renderValue(row.original.oldValue) },
  {
    header: 'New',
    cell: ({ row }) =>
      row.original.newValue === null ? (
        <span className="text-muted-foreground">Reset to inherited</span>
      ) : (
        renderValue(row.original.newValue)
      ),
  },
  { header: 'Changed by', cell: ({ row }) => row.original.changedBy?.email ?? '—' },
  { header: 'Reason', cell: ({ row }) => row.original.reason ?? '—' },
];

/** Configuration history (spec §63): previous value, new value, who, when, why. */
export function HistoryTab() {
  return (
    <ResourceTable
      queryKey={['settings-history']}
      fetchPage={({ cursor, limit }) => api.get('/v1/admin/settings/history', { cursor, limit })}
      columns={columns}
      empty={
        <EmptyState title="No changes yet" description="Every configuration change will be listed here." />
      }
    />
  );
}
