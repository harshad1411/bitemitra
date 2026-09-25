'use client';

import { useState } from 'react';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/jamzo/form-field';

/**
 * Money paid outside Jamzo (a cash-on-delivery refund, a settlement payout): record the UPI / bank transfer
 * reference. `title` and `intro` override the refund wording.
 */
export function PaidDialog({ refund, busy, onClose, onSave, title = 'Record the payout', intro }) {
  const [reference, setReference] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {intro ??
              `Pay ${formatPaise(refund.amountPaise)} to the customer by UPI or bank transfer first, then enter its reference. Recorded in the audit log.`}
          </DialogDescription>
        </DialogHeader>
        <FormField id="payout-reference" label="Transfer reference (UTR / UPI id)">
          {(a) => <Input {...a} value={reference} onChange={(e) => setReference(e.target.value)} />}
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={reference.trim().length < 4 || busy} onClick={() => onSave(reference.trim())}>
            Mark paid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
