'use client';

import { Suspense, use, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/jamzo/page-header';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { ErrorState, LoadingRows } from '@/components/jamzo/states';
import { OverviewTab } from '@/components/restaurants/overview-tab';
import { BranchesTab } from '@/components/restaurants/branches-tab';
import { MenuTab } from '@/components/restaurants/menu-tab';
import { DocumentsTab } from '@/components/restaurants/documents-tab';
import { BankTab } from '@/components/restaurants/bank-tab';
import { TeamTab } from '@/components/restaurants/team-tab';
import { RestaurantSettingsTab } from '@/components/restaurants/settings-tab';
import { RestaurantPricingTab } from '@/components/restaurants/pricing-tab';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { STATUS } from '@/lib/restaurants';

/** Onboarding actions offered by the API for the current status (the server re-checks everything). */
function StatusActions({ restaurant }) {
  const [pending, setPending] = useState(null);
  const move = useApiMutation({
    mutationFn: ({ to, reason }) =>
      api.post(`/v1/admin/restaurants/${restaurant.id}/transitions`, { to, reason: reason || undefined }),
    invalidate: [['restaurant', restaurant.id], ['restaurants']],
    success: (r) => `${r.name}: ${STATUS[r.onboardingStatus].label}`,
    onSuccess: () => setPending(null),
  });
  const offered = restaurant.transitions.filter((t) => t.allowed);
  if (!offered.length) return null;
  const blocking = (t) =>
    t.check
      ? restaurant.readiness.filter(
          (c) =>
            !c.ok &&
            { submit: ['submit'], approve: ['submit', 'approve'], live: ['submit', 'approve', 'live'] }[
              t.check
            ].includes(c.level),
        )
      : [];
  return (
    <>
      {offered.map((t) => {
        const blockers = blocking(t);
        const destructive = t.to === 'SUSPENDED' || t.to === 'DOCUMENTS_PENDING';
        return (
          <Button
            key={t.to}
            variant={destructive ? 'outline' : 'default'}
            disabled={blockers.length > 0}
            title={blockers.length ? `Not ready: ${blockers.map((b) => b.label).join('; ')}` : undefined}
            onClick={() => setPending(t)}
          >
            {t.label}
          </Button>
        );
      })}
      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? `${pending.label}: ${restaurant.name}?` : ''}
        description={
          pending?.to === 'SUSPENDED'
            ? 'The restaurant disappears from the customer app and its team loses access to the partner app until it is reinstated.'
            : pending?.to === 'ACTIVE'
              ? 'The restaurant becomes live: customers will be able to order once ordering launches (Phase 5).'
              : undefined
        }
        confirmLabel={pending?.label}
        destructive={pending?.to === 'SUSPENDED'}
        requireReason={pending?.requiresReason}
        busy={move.isPending}
        onConfirm={(reason) => move.mutate({ to: pending.to, reason })}
      />
    </>
  );
}

function RestaurantContent({ id }) {
  const { can } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get('tab') ?? 'overview';
  const q = useQuery({ queryKey: ['restaurant', id], queryFn: () => api.get(`/v1/admin/restaurants/${id}`) });
  if (q.isPending) return <LoadingRows />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const s = STATUS[r.onboardingStatus];
  const failingDocs = r.readiness.some((c) => !c.ok && c.key.startsWith('documents'));
  return (
    <>
      <PageHeader
        back={{ href: '/restaurants', label: 'Restaurants' }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {r.name} <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
            {r.isPureVeg ? <StatusBadge tone="success">Pure veg</StatusBadge> : null}
          </span>
        }
        description={`${r.cuisines.join(', ') || 'No cuisines yet'} · ${r.city.name}, ${r.city.stateName}`}
        actions={<StatusActions restaurant={r} />}
      />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`)}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="branches">Branches &amp; hours</TabsTrigger>
          <TabsTrigger value="menu">Menu</TabsTrigger>
          <TabsTrigger value="documents">Documents{failingDocs ? ' •' : ''}</TabsTrigger>
          <TabsTrigger value="bank">Bank accounts</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          {can('pricing.view') ? <TabsTrigger value="pricing">Pricing</TabsTrigger> : null}
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab restaurant={r} />
        </TabsContent>
        <TabsContent value="branches">
          <BranchesTab restaurant={r} />
        </TabsContent>
        <TabsContent value="menu">
          <MenuTab restaurant={r} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab restaurant={r} />
        </TabsContent>
        <TabsContent value="bank">
          <BankTab restaurant={r} />
        </TabsContent>
        <TabsContent value="team">
          <TeamTab restaurant={r} />
        </TabsContent>
        {can('pricing.view') ? (
          <TabsContent value="pricing">
            <RestaurantPricingTab restaurant={r} />
          </TabsContent>
        ) : null}
        <TabsContent value="settings">
          <RestaurantSettingsTab restaurant={r} />
        </TabsContent>
      </Tabs>
    </>
  );
}

export default function RestaurantPage({ params }) {
  const { id } = use(params);
  return (
    <Suspense>
      <RestaurantContent id={id} />
    </Suspense>
  );
}
