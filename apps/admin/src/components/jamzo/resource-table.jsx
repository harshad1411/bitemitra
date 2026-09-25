'use client';

import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, ErrorState, LoadingRows } from './states';

/**
 * Dense, server-paginated table (spec §28/§29, OD-25). All filtering, search and paging happen on the
 * API with keyset cursors, so it stays fast on large datasets. `fetchPage({ cursor, q, limit, ...filters })`
 * must return `{ items, nextCursor }`. `selection` = { selected: string[], onChange(ids) } adds row checkboxes
 * (for bulk actions on the current page).
 */
export function ResourceTable({
  queryKey,
  fetchPage,
  columns,
  searchPlaceholder,
  filters,
  toolbar,
  onRowClick,
  rowLabel,
  empty,
  pageSize = 25,
  selection,
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cursors, setCursors] = useState([null]); // cursor stack for previous/next
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const filterKey = JSON.stringify(filters ?? {});
  useEffect(() => setCursors([null]), [debounced, filterKey]);

  const cursor = cursors[cursors.length - 1];
  const query = useQuery({
    queryKey: [...queryKey, { q: debounced, cursor, filters: filterKey, pageSize }],
    queryFn: () =>
      fetchPage({
        cursor: cursor ?? undefined,
        q: debounced || undefined,
        limit: pageSize,
        ...(filters ?? {}),
      }),
    placeholderData: keepPreviousData,
  });
  const items = query.data?.items ?? [];
  const selectColumn = selection
    ? [
        {
          id: '_select',
          header: () => {
            const all = items.length > 0 && items.every((r) => selection.selected.includes(r.id));
            return (
              <Checkbox
                aria-label="Select all on this page"
                checked={all}
                onCheckedChange={(v) =>
                  selection.onChange(
                    v
                      ? [...new Set([...selection.selected, ...items.map((r) => r.id)])]
                      : selection.selected.filter((id) => !items.some((r) => r.id === id)),
                  )
                }
              />
            );
          },
          cell: ({ row }) => (
            <Checkbox
              aria-label={`Select ${row.original.name ?? row.original.id}`}
              checked={selection.selected.includes(row.original.id)}
              onClick={(e) => e.stopPropagation()}
              onCheckedChange={(v) =>
                selection.onChange(
                  v
                    ? [...selection.selected, row.original.id]
                    : selection.selected.filter((id) => id !== row.original.id),
                )
              }
            />
          ),
        },
      ]
    : [];
  const table = useReactTable({
    data: items,
    columns: [...selectColumn, ...columns],
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {searchPlaceholder || toolbar ? (
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          {searchPlaceholder ? (
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="pl-8"
              />
            </div>
          ) : null}
          {toolbar}
        </div>
      ) : null}

      {query.isPending ? (
        <LoadingRows columns={Math.min(columns.length, 5)} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data.items.length ? (
        (empty ?? <EmptyState title="Nothing here yet" />)
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((h) => (
                    <TableHead
                      key={h.id}
                      className="h-9 text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    >
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={
                    onRowClick
                      ? 'cursor-pointer focus-visible:bg-accent focus-visible:outline-none'
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick && rowLabel ? rowLabel(row.original) : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick ? (e) => (e.key === 'Enter' ? onRowClick(row.original) : undefined) : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
        <span aria-live="polite">
          {query.isFetching && !query.isPending ? 'Updating…' : `Page ${cursors.length}`}
        </span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={cursors.length === 1}
            onClick={() => setCursors((c) => c.slice(0, -1))}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!query.data?.nextCursor}
            onClick={() => setCursors((c) => [...c, query.data.nextCursor])}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
