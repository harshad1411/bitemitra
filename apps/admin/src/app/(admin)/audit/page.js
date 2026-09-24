'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const columns = [
  {
    header: 'When',
    cell: ({ row }) => <span className="whitespace-nowrap">{formatDateTime(row.original.createdAt)}</span>,
  },
  { header: 'Action', cell: ({ row }) => <span className="font-mono text-xs">{row.original.action}</span> },
  { header: 'Entity', cell: ({ row }) => <span className="text-xs">{row.original.entityType}</span> },
  {
    header: 'Actor',
    cell: ({ row }) =>
      row.original.actor?.email ??
      `${row.original.actorType.toLowerCase()}${row.original.actorId ? '' : ' (system)'}`,
  },
  {
    header: 'IP',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.ipAddress ?? '—'}</span>,
  },
];

function AuditContent() {
  const params = useSearchParams();
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [open, setOpen] = useState(null);
  const filters = {
    action: action.trim() || undefined,
    entityType: entityType.trim() || undefined,
    actorId: params.get('actorId') ?? undefined,
  };
  return (
    <>
      <ResourceTable
        queryKey={['audit']}
        fetchPage={({ cursor, limit, ...f }) => api.get('/v1/admin/audit-logs', { cursor, limit, ...f })}
        filters={filters}
        columns={columns}
        onRowClick={setOpen}
        rowLabel={(r) => `Open ${r.action}`}
        toolbar={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Action starts with… (e.g. setting.)"
              aria-label="Filter by action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
            <Input
              placeholder="Entity type (e.g. city)"
              aria-label="Filter by entity type"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            />
          </div>
        }
        empty={<EmptyState title="No audit entries match" />}
      />
      <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono">{open?.action}</DialogTitle>
          </DialogHeader>
          {open ? (
            <div className="grid gap-3 text-sm">
              <p>
                {open.entityType}{' '}
                {open.entityId ? <span className="font-mono text-xs">{open.entityId}</span> : null}
              </p>
              <p className="text-muted-foreground">
                {formatDateTime(open.createdAt)} · {open.actor?.email ?? open.actorType} · request{' '}
                {open.requestId}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium">Before</p>
                  <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(open.oldValue, null, 2) ?? '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">After</p>
                  <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(open.newValue, null, 2) ?? '—'}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Who changed what, when, from which IP — with the before and after values."
      />
      <Suspense>
        <AuditContent />
      </Suspense>
    </>
  );
}
