'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { AppShell } from '@/components/jamzo/app-shell';
import { useAuth } from '@/lib/auth';

export default function AdminLayout({ children }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-screen" aria-busy="true" aria-label="Loading Jamzo Admin">
        <div className="hidden w-60 border-r bg-sidebar p-4 lg:block">
          <Skeleton className="mb-6 h-7 w-32" />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="mb-2 h-6 w-full" />
          ))}
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="mb-4 h-7 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}
