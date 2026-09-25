'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/jamzo/page-header';
import { RulesTab } from '@/components/pricing/rules-tab';
import { QuoteTab } from '@/components/pricing/quote-tab';
import { RULE_TYPES } from '@/lib/pricing';

function PricingContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get('tab') ?? 'MARKUP';
  return (
    <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`)}>
      <TabsList className="mb-4 flex-wrap">
        {RULE_TYPES.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
        <TabsTrigger value="QUOTE">Test quote</TabsTrigger>
      </TabsList>
      {RULE_TYPES.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          <RulesTab type={t.value} />
        </TabsContent>
      ))}
      <TabsContent value="QUOTE">
        <QuoteTab />
      </TabsContent>
    </Tabs>
  );
}

export default function PricingPage() {
  return (
    <>
      <PageHeader
        title="Pricing"
        description="Versioned commercial rules. All amounts are development placeholders until you set real values; tax needs CA confirmation (Q-3) and markup needs legal confirmation (Q-4)."
      />
      <Suspense>
        <PricingContent />
      </Suspense>
    </>
  );
}
