'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState, ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { RULE_TYPES, SCOPES, summarize } from '@/lib/pricing';
import { RuleDialog } from './rule-dialog';

const STATUS_TONE = { ACTIVE: 'success', SCHEDULED: 'info', ENDED: 'neutral' };
const SCOPE_ORDER = [
  'GLOBAL',
  'COUNTRY',
  'STATE',
  'CITY',
  'ZONE',
  'RESTAURANT',
  'BRANCH',
  'CATEGORY',
  'PRODUCT',
  'VARIANT',
];

function HistorySheet({ type, rule, onClose }) {
  const q = useQuery({
    queryKey: ['pricing', 'history', rule.id],
    queryFn: () => api.get(`/v1/admin/pricing/rules/${type}/${rule.id}/history`),
  });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>History</SheetTitle>
          <SheetDescription>
            {rule.targetName}: every version, newest first. Orders keep the version they were priced with.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 p-4">
          {q.isPending ? <LoadingRows rows={3} columns={1} /> : null}
          {(q.data?.items ?? []).map((v) => (
            <div key={v.id} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{summarize(type, v.params)}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(v.effectiveFrom)} → {v.effectiveTo ? formatDateTime(v.effectiveTo) : 'open'}
              </p>
              {v.changeNote ? <p className="mt-1 text-xs">“{v.changeNote}”</p> : null}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function RulesTab({ type }) {
  const { can } = useAuth();
  const def = RULE_TYPES.find((r) => r.value === type);
  const canWrite = can(def.permission);
  const [dialog, setDialog] = useState(null); // { basedOn } | { new: true }
  const [ending, setEnding] = useState(null);
  const [history, setHistory] = useState(null);
  const q = useQuery({
    queryKey: ['pricing', 'rules', type],
    queryFn: () => api.get('/v1/admin/pricing/rules', { type }),
  });
  const end = useApiMutation({
    mutationFn: ({ rule, changeNote }) =>
      api.post(`/v1/admin/pricing/rules/${type}/${rule.id}/end`, { changeNote }),
    invalidate: [['pricing'], ['menu']],
    success: 'Rule ended — the parent rule applies again',
    onSuccess: () => setEnding(null),
  });
  const toggle = useApiMutation({
    mutationFn: ({ rule, isEnabled }) =>
      api.patch(`/v1/admin/pricing/surge/${rule.id}/switch`, {
        isEnabled,
        changeNote: isEnabled ? 'Switched on from the admin' : 'Switched off from the admin',
      }),
    invalidate: [['pricing']],
    success: (r) => (r.isEnabled ? 'Surcharge on' : 'Surcharge off'),
  });
  const rows = [...(q.data?.items ?? [])].sort(
    (a, b) =>
      SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope) ||
      (a.targetName ?? '').localeCompare(b.targetName ?? ''),
  );
  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          {def.help} The most specific rule wins:{' '}
          {['MARKUP', 'COMMISSION', 'TAX'].includes(type) ? 'product → category → ' : ''}restaurant → zone →
          city → all cities.
        </p>
        {canWrite ? (
          <Button onClick={() => setDialog({ new: true })}>
            <Plus /> Add rule
          </Button>
        ) : null}
      </div>
      <Card className="overflow-hidden py-0">
        {q.isPending ? (
          <LoadingRows />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            title={`No ${def.label.toLowerCase()} rules`}
            description="Without a rule, nothing is charged for this (tax and delivery are reported as not configured)."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applies to</TableHead>
                  {type === 'SURGE' ? <TableHead>Kind</TableHead> : null}
                  <TableHead>Rule</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="font-medium">{r.targetName}</p>
                      <p className="text-xs text-muted-foreground">
                        {SCOPES.find((s) => s.value === r.scope)?.label ?? r.scope}
                      </p>
                    </TableCell>
                    {type === 'SURGE' ? <TableCell className="text-xs">{r.kind}</TableCell> : null}
                    <TableCell className="max-w-md text-sm whitespace-normal">
                      {summarize(type, r.params)}
                      {r.pendingCaReview ? (
                        <StatusBadge tone="warning" className="ml-2">
                          Pending CA review
                        </StatusBadge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatDateTime(r.effectiveFrom)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge tone={STATUS_TONE[r.status]}>
                        {r.status === 'ACTIVE' ? 'Active' : r.status === 'SCHEDULED' ? 'Scheduled' : 'Ended'}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {type === 'SURGE' && can('pricing.surge') ? (
                        <Switch
                          className="mr-2 align-middle"
                          aria-label={`${r.kind} surcharge on`}
                          checked={r.isEnabled}
                          disabled={toggle.isPending}
                          onCheckedChange={(isEnabled) => toggle.mutate({ rule: r, isEnabled })}
                        />
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`History of ${r.targetName}`}
                        onClick={() => setHistory(r)}
                      >
                        <History />
                      </Button>
                      {canWrite && r.status !== 'ENDED' ? (
                        <>
                          <Button variant="link" size="sm" onClick={() => setDialog({ basedOn: r })}>
                            New version
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            className="text-destructive"
                            onClick={() => setEnding(r)}
                          >
                            End
                          </Button>
                        </>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
      {dialog ? (
        <RuleDialog type={type} basedOn={dialog.basedOn ?? null} onClose={() => setDialog(null)} />
      ) : null}
      {history ? <HistorySheet type={type} rule={history} onClose={() => setHistory(null)} /> : null}
      <ConfirmDialog
        open={Boolean(ending)}
        onOpenChange={(o) => !o && setEnding(null)}
        title={`End this rule for ${ending?.targetName}?`}
        description="From now on the next less specific rule applies (or nothing, if none exists). Past orders are not affected."
        confirmLabel="End rule"
        destructive
        requireReason
        busy={end.isPending}
        onConfirm={(changeNote) => end.mutate({ rule: ending, changeNote })}
      />
    </div>
  );
}
