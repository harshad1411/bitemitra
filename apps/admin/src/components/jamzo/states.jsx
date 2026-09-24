'use client';

import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/** Shown when a list or page has no data. Always say what the user can do next. */
export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Icon className="size-8 text-muted-foreground" aria-hidden />
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Shown when a request failed. Includes the request id so support can find the server log. */
export function ErrorState({ error, onRetry, title = 'Could not load this' }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{error?.message ?? 'Something went wrong.'}</p>
      {error?.requestId ? (
        <p className="font-mono text-xs text-muted-foreground">Request ID: {error.requestId}</p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Skeleton rows while loading — keeps layout stable (no spinners jumping around). */
export function LoadingRows({ rows = 6, columns = 4 }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
