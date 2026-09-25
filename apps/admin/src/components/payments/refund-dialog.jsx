'use client';

import { useMemo, useState } from 'react';
import { formatPaise, parseRupeesToPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { PriceInput } from '@/components/jamzo/price-input';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { BEARER, REFUND_TYPE } from '@/lib/payments';

/**
 * Refund part or all of an order (D-86). The server works out the amount for each type and refuses more
 * than is left; one idempotency key per dialog makes a double click harmless.
 */
export function RefundDialog({ order, onClose }) {
  const key = useMemo(() => crypto.randomUUID(), []);
  const [type, setType] = useState('PARTIAL');
  const [amount, setAmount] = useState('');
  const [itemIds, setItemIds] = useState([]);
  const [reason, setReason] = useState('');
  const [bearer, setBearer] = useState('PLATFORM');
  const m = useApiMutation({
    mutationFn: () =>
      api.post(`/v1/admin/orders/${order.id}/refunds`, {
        type,
        ...(type === 'PARTIAL' || type === 'MANUAL' ? { amountPaise: parseRupeesToPaise(amount) } : {}),
        ...(type === 'ITEM' ? { itemIds } : {}),
        reason: reason.trim(),
        bearer,
        idempotencyKey: key,
      }),
    invalidate: [['order', order.id], ['refunds']],
    success: (r) =>
      r.status === 'PENDING_APPROVAL' ? 'Refund created — waiting for a second admin' : 'Refund created',
    onSuccess: onClose,
  });
  const needsAmount = type === 'PARTIAL' || type === 'MANUAL';
  const ready =
    reason.trim().length >= 3 &&
    (!needsAmount || parseRupeesToPaise(amount) > 0) &&
    (type !== 'ITEM' || itemIds.length > 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund {order.orderNumber}</DialogTitle>
          <DialogDescription>
            {`Up to ${formatPaise(order.refundablePaise)} can still be refunded. ${
              order.payment?.method === 'COD'
                ? 'Cash on delivery: you pay the customer back by UPI or bank transfer and record the reference.'
                : 'Online: the money goes back through the payment gateway.'
            }`}
          </DialogDescription>
        </DialogHeader>
        <FormField id="refund-type" label="What to refund">
          {(a) => (
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id={a.id} aria-label="What to refund">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REFUND_TYPE).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        {needsAmount ? (
          <FormField id="refund-amount" label="Amount" errors={m.fieldErrors.amountPaise}>
            {(a) => <PriceInput {...a} value={amount} onChange={setAmount} />}
          </FormField>
        ) : null}
        {type === 'ITEM' ? (
          <fieldset className="grid gap-2 text-sm">
            <legend className="mb-1 font-medium">Items</legend>
            {order.items.map((i) => (
              <label key={i.id} className="flex items-center gap-2">
                <Checkbox
                  checked={itemIds.includes(i.id)}
                  onCheckedChange={(on) =>
                    setItemIds((ids) => (on ? [...ids, i.id] : ids.filter((x) => x !== i.id)))
                  }
                />
                {`${i.quantity} × ${i.productName} · ${formatPaise(i.lineTotalPaise)}`}
              </label>
            ))}
            <p className="text-muted-foreground">Each item carries its share of the food discount.</p>
          </fieldset>
        ) : null}
        <FormField id="refund-reason" label="Why (the customer may see this)">
          {(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </FormField>
        <FormField id="refund-bearer" label="Who pays for it">
          {(a) => (
            <Select value={bearer} onValueChange={setBearer}>
              <SelectTrigger id={a.id} aria-label="Who pays for it">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(BEARER).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || m.isPending} onClick={() => m.mutate()}>
            Create refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
