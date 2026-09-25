'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatPaise, parseRupeesToPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/jamzo/form-field';
import { PageHeader } from '@/components/jamzo/page-header';
import { PriceInput } from '@/components/jamzo/price-input';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';
import { ENTRY_TYPE, signedPaise } from '@/lib/settlements';
import { useQuery } from '@tanstack/react-query';

const columns = [
  { header: 'When', cell: ({ row }) => formatDateTime(row.original.createdAt) },
  {
    header: 'Order',
    cell: ({ row }) =>
      row.original.orderId ? (
        <Link className="font-mono text-xs hover:underline" href={`/orders/${row.original.orderId}`}>
          {row.original.orderNumber}
        </Link>
      ) : (
        '—'
      ),
  },
  {
    header: 'What',
    cell: ({ row }) => (
      <span>
        {ENTRY_TYPE[row.original.type] ?? row.original.type}
        {row.original.description ? (
          <span className="text-muted-foreground"> · {row.original.description}</span>
        ) : null}
      </span>
    ),
  },
  {
    header: 'Amount',
    cell: ({ row }) => <span className="tabular-nums">{formatPaise(signedPaise(row.original))}</span>,
  },
  {
    header: 'Settled',
    cell: ({ row }) =>
      row.original.settlementId ? 'Yes' : <span className="text-muted-foreground">Not yet</span>,
  },
];

/** A manual credit or debit with a reason (D-92); one key per dialog makes a double click harmless. */
function AdjustDialog({ kind, id, onClose }) {
  const key = useMemo(() => crypto.randomUUID(), []);
  const [type, setType] = useState(kind === 'restaurant' ? 'CREDIT' : 'BONUS');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const m = useApiMutation({
    mutationFn: () =>
      api.post(`/v1/admin/ledgers/${kind}/${id}/adjustments`, {
        ...(kind === 'restaurant'
          ? { direction: type }
          : {
              type: type.startsWith('ADJUSTMENT') ? 'ADJUSTMENT' : type,
              direction: type === 'ADJUSTMENT_DEBIT' ? 'DEBIT' : 'CREDIT',
            }),
        amountPaise: parseRupeesToPaise(amount),
        reason: reason.trim(),
        idempotencyKey: key,
      }),
    invalidate: [['ledger', kind, id]],
    success: 'Adjustment posted',
    onSuccess: onClose,
  });
  const options =
    kind === 'restaurant'
      ? [
          ['CREDIT', 'Credit (Jamzo owes more)'],
          ['DEBIT', 'Debit (Jamzo owes less)'],
        ]
      : [
          ['BONUS', 'Bonus'],
          ['ADJUSTMENT_CREDIT', 'Adjustment (credit)'],
          ['ADJUSTMENT_DEBIT', 'Adjustment (debit)'],
          ['PENALTY', 'Penalty (only where legally allowed)'],
        ];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust the ledger</DialogTitle>
          <DialogDescription>
            Entries are never edited: this adds a new one, recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <FormField id="adj-type" label="Kind">
          {(a) => (
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id={a.id} aria-label="Kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <FormField id="adj-amount" label="Amount">
          {(a) => <PriceInput {...a} value={amount} onChange={setAmount} />}
        </FormField>
        <FormField id="adj-reason" label="Why">
          {(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!(parseRupeesToPaise(amount) > 0) || reason.trim().length < 3 || m.isPending}
            onClick={() => m.mutate()}
          >
            Post adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LedgerPage({ params }) {
  const { kind, id } = use(params);
  const [adjusting, setAdjusting] = useState(false);
  const head = useQuery({
    queryKey: ['ledger', kind, id, 'head'],
    queryFn: () => api.get(`/v1/admin/ledgers/${kind}/${id}`, { limit: 1 }),
  });
  const h = head.data;
  const summary = !h
    ? ''
    : kind === 'restaurant'
      ? `Jamzo owes ${formatPaise(h.balancePaise)}`
      : `Earnings not paid ${formatPaise(h.earningsBalancePaise)} · cash held ${formatPaise(h.codHeldPaise)} · ${
          h.owesPaise ? `owes Jamzo ${formatPaise(h.owesPaise)}` : `Jamzo owes ${formatPaise(h.owedPaise)}`
        }`;
  return (
    <>
      <PageHeader
        back={
          kind === 'restaurant'
            ? { href: `/restaurants/${id}`, label: 'Restaurant' }
            : { href: `/riders/${id}`, label: 'Delivery partner' }
        }
        title={`Ledger · ${h?.name ?? ''}`}
        description={summary}
        actions={h?.permissions.adjust ? <Button onClick={() => setAdjusting(true)}>Adjust</Button> : null}
      />
      <ResourceTable
        queryKey={['ledger', kind, id]}
        fetchPage={(p) => api.get(`/v1/admin/ledgers/${kind}/${id}`, p)}
        columns={columns}
        empty={
          <EmptyState
            title="No entries yet"
            description="Entries appear when orders are delivered or cancelled."
          />
        }
      />
      {adjusting ? <AdjustDialog kind={kind} id={id} onClose={() => setAdjusting(false)} /> : null}
    </>
  );
}
