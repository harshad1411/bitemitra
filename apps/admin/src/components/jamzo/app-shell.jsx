'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { ADMIN_APP } from '@jamzo/config/apps';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NAV } from '@/lib/nav';
import { useAuth } from '@/lib/auth';

function NavList({ onNavigate }) {
  const pathname = usePathname();
  const { can } = useAuth();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4 p-3">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.permission || can(i.permission));
        if (!items.length) return null;
        return (
          <div key={group.section}>
            <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {group.section}
            </p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                if (!item.href) {
                  return (
                    <li key={item.label}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground/70"
                            aria-disabled="true"
                          >
                            <Icon className="size-4" aria-hidden />
                            <span className="flex-1">{item.label}</span>
                            <span className="rounded bg-muted px-1.5 text-[10px] font-medium">
                              Phase {item.phase}
                            </span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          Not built yet — arrives in Phase {item.phase}.
                        </TooltipContent>
                      </Tooltip>
                    </li>
                  );
                }
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                return (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                        active && 'bg-accent font-medium text-accent-foreground',
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-4 py-3 font-semibold">
      <span
        className="grid size-7 place-items-center rounded-md bg-primary text-sm text-primary-foreground"
        aria-hidden
      >
        J
      </span>
      {ADMIN_APP.displayName}
    </Link>
  );
}

export function AppShell({ children }) {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const roles = me?.admin?.roles ?? [];
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-card focus:p-2"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r bg-sidebar lg:block">
        <Brand />
        <NavList />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 overflow-y-auto p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
          <NavList onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-card/95 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <span
                  className="grid size-7 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
                  aria-hidden
                >
                  {(me?.user?.name ?? me?.user?.email ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden text-sm sm:inline">{me?.user?.name ?? me?.user?.email}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium">{me?.user?.name}</p>
                <p className="text-xs text-muted-foreground">{me?.user?.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">{roles.map((r) => r.name).join(', ')}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => logout()}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
