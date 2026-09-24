'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Images } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { PageHeader } from '@/components/jamzo/page-header';
import { ResourceTable } from '@/components/jamzo/resource-table';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState } from '@/components/jamzo/states';
import { FormField } from '@/components/jamzo/form-field';
import { api, apiUrl, getAccessTokenForUpload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { formatDateTime } from '@/lib/format';

const STATUS_TONE = { READY: 'success', PENDING: 'warning', FAILED: 'critical' };

function EditMediaDialog({ media, onClose }) {
  const [altText, setAlt] = useState(media.altText ?? '');
  const [title, setTitle] = useState(media.title ?? '');
  const [tags, setTags] = useState((media.tags ?? []).join(', '));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { can } = useAuth();
  const save = useApiMutation({
    mutationFn: () =>
      api.patch(`/v1/admin/media/${media.id}`, {
        altText: altText || null,
        title: title || null,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    invalidate: [['media']],
    success: 'Saved',
    onSuccess: onClose,
  });
  const remove = useApiMutation({
    mutationFn: () => api.delete(`/v1/admin/media/${media.id}`),
    invalidate: [['media']],
    success: 'Removed from library',
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{media.title ?? 'Image'}</DialogTitle>
          <DialogDescription>
            {media.mimeType} · {(media.sizeBytes / 1024).toFixed(0)} KB{' '}
            {media.width ? `· ${media.width}×${media.height}` : ''} · uploaded{' '}
            {formatDateTime(media.createdAt)}
          </DialogDescription>
        </DialogHeader>
        <img
          src={apiUrl(media.urls.medium ?? media.urls.original)}
          alt={media.altText ?? ''}
          className="max-h-64 w-full rounded border object-contain"
        />
        <div className="grid gap-3">
          <FormField
            id="m-alt"
            label="Alt text"
            help="Describes the image for screen readers."
            errors={save.fieldErrors.altText}
          >
            {(a) => (
              <Input
                {...a}
                value={altText}
                onChange={(e) => setAlt(e.target.value)}
                disabled={!can('media.manage')}
              />
            )}
          </FormField>
          <FormField id="m-title" label="Title" errors={save.fieldErrors.title}>
            {(a) => (
              <Input
                {...a}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!can('media.manage')}
              />
            )}
          </FormField>
          <FormField id="m-tags" label="Tags" help="Comma-separated" errors={save.fieldErrors.tags}>
            {(a) => (
              <Input
                {...a}
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                disabled={!can('media.manage')}
              />
            )}
          </FormField>
        </div>
        {can('media.manage') ? (
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
              Remove
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        ) : null}
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Remove this image?"
          description="It disappears from the library and is no longer served. The record is kept for the audit trail."
          destructive
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </DialogContent>
    </Dialog>
  );
}

const columns = [
  {
    header: 'Preview',
    cell: ({ row }) => (
      <img
        src={apiUrl(row.original.urls.thumb ?? row.original.urls.original)}
        alt={row.original.altText ?? ''}
        className="size-12 rounded border object-cover"
        loading="lazy"
      />
    ),
  },
  {
    header: 'Title',
    cell: ({ row }) => <span className="font-medium">{row.original.title ?? 'Untitled'}</span>,
  },
  {
    header: 'Alt text',
    cell: ({ row }) => row.original.altText ?? <span className="text-destructive">Missing</span>,
  },
  { header: 'Tags', cell: ({ row }) => row.original.tags.join(', ') || '—' },
  {
    header: 'Renditions',
    cell: ({ row }) => (
      <StatusBadge tone={STATUS_TONE[row.original.status] ?? 'neutral'}>
        {row.original.status === 'PENDING'
          ? 'Processing'
          : row.original.status === 'READY'
            ? 'Ready'
            : 'Failed'}
      </StatusBadge>
    ),
  },
  { header: 'Uploaded', cell: ({ row }) => formatDateTime(row.original.createdAt) },
];

export default function MediaPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  async function upload(files) {
    setBusy(true);
    for (const file of files) {
      const body = new FormData();
      body.set('file', file);
      body.set('title', file.name);
      try {
        const idempotencyKey = crypto.randomUUID();
        const send = () =>
          fetch(apiUrl('/v1/admin/media'), {
            method: 'POST',
            body,
            headers: {
              'x-app-id': 'ADMIN',
              'x-platform': 'WEB',
              authorization: `Bearer ${getAccessTokenForUpload()}`,
              'idempotency-key': idempotencyKey,
            },
          });
        let res = await send();
        if (res.status === 401 && (await api.refreshSession())) res = await send(); // access token expired: refresh once, same key
        const json = await res.json();
        if (!res.ok) throw Object.assign(new Error(json.error?.message ?? 'Upload failed'), json.error);
        toast.success(`${file.name} uploaded — renditions are generated in the background`);
      } catch (err) {
        toast.error(`${file.name}: ${err.message}`, {
          description: err.requestId ? `Request ID: ${err.requestId}` : undefined,
        });
      }
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ['media'] });
  }

  return (
    <>
      <PageHeader
        title="Media library"
        description="JPEG, PNG or WebP up to 10 MB. Thumbnails and resized WebP versions are generated automatically so apps never download full-size originals."
        actions={
          can('media.manage') ? (
            <>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(e) => upload([...e.target.files])}
              />
              <Button onClick={() => input.current?.click()} disabled={busy}>
                <ImagePlus /> {busy ? 'Uploading…' : 'Upload images'}
              </Button>
            </>
          ) : null
        }
      />
      <ResourceTable
        queryKey={['media']}
        fetchPage={(p) => api.get('/v1/admin/media', p)}
        columns={columns}
        searchPlaceholder="Search title, alt text or tag"
        onRowClick={setEditing}
        rowLabel={(m) => `Open ${m.title ?? 'image'}`}
        empty={
          <EmptyState
            icon={Images}
            title="No images yet"
            description="Upload banners, restaurant and product images to reuse across the apps."
          />
        }
      />
      {editing ? <EditMediaDialog media={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}
