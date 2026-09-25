'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { toast } from 'sonner';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField } from '@/components/jamzo/form-field';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState } from '@/components/jamzo/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { openPrivateFile, uploadForm } from '@/lib/upload';
import { formatDateTime, titleCase } from '@/lib/format';
import { DOCUMENT_KINDS, DOCUMENT_TONE, documentKindLabel } from '@/lib/restaurants';

function UploadDialog({ restaurantId, onClose }) {
  const qc = useQueryClient();
  const file = useRef(null);
  const [form, setForm] = useState({ kind: 'FSSAI', number: '', expiresOn: '' });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  async function submit() {
    setBusy(true);
    setErrors({});
    const body = new FormData();
    body.set('kind', form.kind);
    if (form.number) body.set('number', form.number);
    if (form.expiresOn) body.set('expiresOn', form.expiresOn);
    const f = file.current?.files?.[0];
    if (f) body.set('file', f);
    try {
      await uploadForm(`/v1/admin/restaurants/${restaurantId}/documents`, body);
      toast.success(`${documentKindLabel(form.kind)} added — waiting for verification`);
      await qc.invalidateQueries({ queryKey: ['restaurant', restaurantId] });
      onClose();
    } catch (err) {
      setErrors(err.fieldErrors ?? {});
      toast.error(err.message, { description: err.requestId ? `Request ID: ${err.requestId}` : undefined });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a document</DialogTitle>
          <DialogDescription>
            PDF, JPEG or PNG up to 10 MB. Files are private: they are never public links and every view is
            logged.
          </DialogDescription>
        </DialogHeader>
        <form id="doc-form" className="grid gap-3" onSubmit={(e) => (e.preventDefault(), submit())}>
          <FormField id="d-kind" label="Document" errors={errors.kind}>
            <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))}>
              <SelectTrigger id="d-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            id="d-number"
            label="Number"
            errors={errors.number}
            help="FSSAI: 14 digits · PAN: ABCDE1234F · GST: 15 characters"
          >
            {(a) => (
              <Input
                {...a}
                value={form.number}
                onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
              />
            )}
          </FormField>
          <FormField id="d-expires" label="Valid until (optional)" errors={errors.expiresOn}>
            {(a) => (
              <Input
                {...a}
                type="date"
                value={form.expiresOn}
                onChange={(e) => setForm((f) => ({ ...f, expiresOn: e.target.value }))}
              />
            )}
          </FormField>
          <FormField id="d-file" label="File" errors={errors.file}>
            {(a) => <Input {...a} ref={file} type="file" accept="application/pdf,image/jpeg,image/png" />}
          </FormField>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="doc-form" disabled={busy}>
            {busy ? 'Uploading…' : 'Add document'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DocumentsTab({ restaurant }) {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState(null);
  const review = useApiMutation({
    mutationFn: ({ id, status, note }) =>
      api.post(`/v1/admin/restaurant-documents/${id}/review`, { status, note: note || undefined }),
    invalidate: [['restaurant', restaurant.id]],
    success: (d) => `${documentKindLabel(d.kind)} ${d.status.toLowerCase()}`,
    onSuccess: () => setRejecting(null),
  });
  const open = async (doc) => {
    try {
      await openPrivateFile(`/v1/admin/restaurant-documents/${doc.id}/file`);
    } catch (err) {
      toast.error(err.message);
    }
  };
  const missing = restaurant.requiredDocumentKinds.filter(
    (k) => !restaurant.documents.some((d) => d.kind === k && d.status !== 'REJECTED'),
  );
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Required before approval:{' '}
            {restaurant.requiredDocumentKinds.map(documentKindLabel).join(', ') || 'none'} (setting “Documents
            required for approval”, pending legal review).
            {missing.length ? ` Missing: ${missing.map(documentKindLabel).join(', ')}.` : ''}
          </CardDescription>
        </div>
        {can('restaurants.manage') ? (
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add document
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {!restaurant.documents.length ? (
          <EmptyState icon={FileText} title="No documents yet" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Valid until</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {restaurant.documents.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{documentKindLabel(d.kind)}</TableCell>
                    <TableCell className="font-mono text-xs">{d.number ?? '—'}</TableCell>
                    <TableCell>{d.expiresOn ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge tone={DOCUMENT_TONE[d.status]}>{titleCase(d.status)}</StatusBadge>
                      {d.reviewNote ? (
                        <p className="mt-1 text-xs text-muted-foreground">{d.reviewNote}</p>
                      ) : null}
                      {d.reviewedAt ? (
                        <p className="text-xs text-muted-foreground">{formatDateTime(d.reviewedAt)}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {d.hasFile ? (
                        <Button variant="link" size="sm" onClick={() => open(d)}>
                          View file
                        </Button>
                      ) : null}
                      {can('restaurants.approve') && d.status !== 'VERIFIED' ? (
                        <Button
                          variant="link"
                          size="sm"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: d.id, status: 'VERIFIED' })}
                        >
                          Verify
                        </Button>
                      ) : null}
                      {can('restaurants.approve') && d.status !== 'REJECTED' ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setRejecting(d)}
                        >
                          Reject
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {adding ? <UploadDialog restaurantId={restaurant.id} onClose={() => setAdding(false)} /> : null}
      <ConfirmDialog
        open={Boolean(rejecting)}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject ${rejecting ? documentKindLabel(rejecting.kind) : ''}?`}
        description="The restaurant will need to upload it again. Say what is wrong so the team can fix it."
        confirmLabel="Reject document"
        destructive
        requireReason
        busy={review.isPending}
        onConfirm={(note) => review.mutate({ id: rejecting.id, status: 'REJECTED', note })}
      />
    </Card>
  );
}
