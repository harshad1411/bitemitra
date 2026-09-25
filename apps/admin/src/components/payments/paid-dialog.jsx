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

/** A cash-on-delivery refund paid back outside the gateway: record the UPI / bank transfer reference. */
export function PaidDialog({ refund, busy, onClose, onSave }) {
  const [reference, setReference] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record the payout</DialogTitle>
          <DialogDescription>
            {`Pay ${formatPaise(refund.amountPaise)} to the customer by UPI or bank transfer first, then enter its reference. Recorded in the audit log.`}
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
