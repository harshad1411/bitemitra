'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImagePlus, Search } from 'lucide-react';
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
import { api, apiUrl } from '@/lib/api';
import { uploadForm } from '@/lib/upload';
import { useAuth } from '@/lib/auth';
import { EmptyState, ErrorState, LoadingRows } from './states';

/**
 * Choose images from the media library (or upload one). `multiple` returns an ordered list of ids.
 * onSelect receives media objects ({ id, urls, altText }).
 */
export function MediaPicker({ open, onOpenChange, onSelect, multiple = false, max = 10, initial = [] }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(initial);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const list = useQuery({
    queryKey: ['media', 'picker', q],
    queryFn: () => api.get('/v1/admin/media', { q: q || undefined, limit: 48 }),
    enabled: open,
  });

  const toggle = (m) =>
    setPicked((cur) => {
      if (!multiple) return [m];
      if (cur.some((x) => x.id === m.id)) return cur.filter((x) => x.id !== m.id);
      return cur.length >= max ? cur : [...cur, m];
    });

  async function upload(files) {
    setBusy(true);
    for (const file of files) {
      const body = new FormData();
      body.set('file', file);
      body.set('title', file.name);
      try {
        const m = await uploadForm('/v1/admin/media', body);
        toggle(m);
      } catch (err) {
        toast.error(`${file.name}: ${err.message}`);
      }
    }
    setBusy(false);
    qc.invalidateQueries({ queryKey: ['media'] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{multiple ? 'Choose images' : 'Choose an image'}</DialogTitle>
          <DialogDescription>
            From the media library{multiple ? `; up to ${max}, in the order you pick them` : ''}. Resized
            versions are made automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-8"
              placeholder="Search images"
              aria-label="Search images"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {can('media.manage') ? (
            <>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple={multiple}
                className="hidden"
                onChange={(e) => upload([...e.target.files])}
              />
              <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
                <ImagePlus /> {busy ? 'Uploading…' : 'Upload'}
              </Button>
            </>
          ) : null}
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {list.isPending ? (
            <LoadingRows columns={4} rows={3} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data.items.length ? (
            <EmptyState title="No images yet" description="Upload an image to use it here." />
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {list.data.items.map((m) => {
                const index = picked.findIndex((x) => x.id === m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m)}
                      aria-pressed={index >= 0}
                      aria-label={`${index >= 0 ? 'Remove' : 'Choose'} ${m.title ?? 'image'}`}
                      className={`relative aspect-square w-full overflow-hidden rounded-md border-2 ${index >= 0 ? 'border-primary' : 'border-transparent'}`}
                    >
                      <img
                        src={apiUrl(m.urls.thumb ?? m.urls.original)}
                        alt={m.altText ?? ''}
                        className="size-full object-cover"
                      />
                      {index >= 0 ? (
                        <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                          {multiple ? index + 1 : <Check className="size-3" />}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSelect(multiple ? picked : (picked[0] ?? null));
              onOpenChange(false);
            }}
          >
            Use {multiple ? `${picked.length} image${picked.length === 1 ? '' : 's'}` : 'image'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
