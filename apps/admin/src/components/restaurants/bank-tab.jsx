'use client';

import { useState } from 'react';
import { Landmark, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/jamzo/form-field';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';

function AddAccountDialog({ restaurantId, onClose }) {
  const [form, setForm] = useState({
    accountHolderName: '',
    accountNumber: '',
    confirmAccountNumber: '',
    ifsc: '',
    bankName: '',
    upiId: '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const m = useApiMutation({
    mutationFn: () =>
      api.post(`/v1/admin/restaurants/${restaurantId}/bank-accounts`, {
        ...form,
        bankName: form.bankName || null,
        upiId: form.upiId || null,
      }),
    invalidate: [['restaurant', restaurantId]],
    success: 'Bank account added — another admin must verify it',
    onSuccess: onClose,
  });
  const e = m.fieldErrors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a bank account</DialogTitle>
          <DialogDescription>
            The account number is encrypted and only the last 4 digits are ever shown. A different admin must
            verify it before it is used for settlements.
          </DialogDescription>
        </DialogHeader>
        <form
          id="bank-form"
          className="grid gap-3"
          onSubmit={(ev) => (ev.preventDefault(), m.mutate())}
          autoComplete="off"
        >
          <FormField id="ba-holder" label="Account holder name" errors={e.accountHolderName}>
            {(a) => <Input {...a} value={form.accountHolderName} onChange={set('accountHolderName')} />}
          </FormField>
          <FormField id="ba-number" label="Account number" errors={e.accountNumber}>
            {(a) => (
              <Input
                {...a}
                inputMode="numeric"
                autoComplete="off"
                value={form.accountNumber}
                onChange={set('accountNumber')}
              />
            )}
          </FormField>
          <FormField id="ba-confirm" label="Confirm account number" errors={e.confirmAccountNumber}>
            {(a) => (
              <Input
                {...a}
                inputMode="numeric"
                autoComplete="off"
                onPaste={(ev) => ev.preventDefault()}
                value={form.confirmAccountNumber}
                onChange={set('confirmAccountNumber')}
              />
            )}
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="ba-ifsc" label="IFSC" errors={e.ifsc}>
              {(a) => <Input {...a} value={form.ifsc} onChange={set('ifsc')} placeholder="HDFC0001234" />}
            </FormField>
            <FormField id="ba-bank" label="Bank name" errors={e.bankName}>
              {(a) => <Input {...a} value={form.bankName} onChange={set('bankName')} />}
            </FormField>
          </div>
          <FormField id="ba-upi" label="UPI ID (optional)" errors={e.upiId}>
            {(a) => <Input {...a} value={form.upiId} onChange={set('upiId')} placeholder="name@bank" />}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="bank-form" disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Add account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BankTab({ restaurant }) {
  const { can, me } = useAuth();
  const [adding, setAdding] = useState(false);
  const [verifying, setVerifying] = useState(null);
  const verify = useApiMutation({
    mutationFn: (id) => api.post(`/v1/admin/restaurant-bank-accounts/${id}/verify`, {}),
    invalidate: [['restaurant', restaurant.id]],
    success: 'Verified — this is now the primary account',
    onSuccess: () => setVerifying(null),
  });
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Bank accounts</CardTitle>
          <CardDescription>
            Settlements (Phase 8) are paid to the verified primary account. No payouts happen in this phase.
          </CardDescription>
        </div>
        {can('restaurants.manage') ? (
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add account
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {!restaurant.bankAccounts.length ? (
          <EmptyState icon={Landmark} title="No bank account yet" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>IFSC</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {restaurant.bankAccounts.map((a) => {
                  const ownEntry = a.createdById === me?.user?.id;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <p className="font-medium">{a.accountHolderName}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {a.accountNumberMasked}
                          {a.bankName ? ` · ${a.bankName}` : ''}
                          {a.upiId ? ` · ${a.upiId}` : ''}
                        </p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{a.ifsc}</TableCell>
                      <TableCell className="text-xs">{formatDateTime(a.createdAt)}</TableCell>
                      <TableCell>
                        {a.isPrimary ? (
                          <StatusBadge tone="success">Primary · verified</StatusBadge>
                        ) : a.verifiedAt ? (
                          <StatusBadge>Verified · replaced</StatusBadge>
                        ) : (
                          <StatusBadge tone="warning">Waiting for verification</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!a.verifiedAt && can('restaurants.approve') ? (
                          ownEntry ? (
                            <span className="text-xs text-muted-foreground">
                              Another admin must verify details you entered
                            </span>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setVerifying(a)}>
                              <ShieldCheck /> Verify
                            </Button>
                          )
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {adding ? <AddAccountDialog restaurantId={restaurant.id} onClose={() => setAdding(false)} /> : null}
      <ConfirmDialog
        open={Boolean(verifying)}
        onOpenChange={(o) => !o && setVerifying(null)}
        title="Verify this bank account?"
        description={`Confirm you checked ${verifying?.accountHolderName} (${verifying?.accountNumberMasked}, ${verifying?.ifsc}) against the cancelled cheque or bank letter. It becomes the primary account for settlements.`}
        confirmLabel="Verify account"
        busy={verify.isPending}
        onConfirm={() => verify.mutate(verifying.id)}
      />
    </Card>
  );
}
