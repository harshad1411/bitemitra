'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';

export default function PermissionsPage() {
  const q = useQuery({ queryKey: ['permissions'], queryFn: () => api.get('/v1/admin/permissions') });
  return (
    <>
      <PageHeader
        title="Permissions"
        description="The permission catalogue is defined in code and enforced by the API on every request. Roles combine these permissions."
      />
      {q.isPending ? (
        <LoadingRows />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Card className="gap-0 overflow-x-auto py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Permission</TableHead>
                <TableHead>What it allows</TableHead>
                <TableHead>In use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.items.map((p) => (
                <TableRow key={p.key}>
                  <TableCell className="font-mono text-xs">{p.key}</TableCell>
                  <TableCell>{p.description}</TableCell>
                  <TableCell>
                    {p.phase === 1 ? (
                      <StatusBadge tone="success">Enforced now</StatusBadge>
                    ) : (
                      <StatusBadge>From Phase {p.phase}</StatusBadge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
