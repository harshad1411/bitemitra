'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/jamzo/page-header';
import { SettingsTab } from '@/components/settings/settings-tab';
import { FlagsTab } from '@/components/settings/flags-tab';
import { VersionsTab } from '@/components/settings/versions-tab';
import { HistoryTab } from '@/components/settings/history-tab';

function ConfigurationContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get('tab') ?? 'settings';
  const scope = params.get('scope') ?? 'GLOBAL';
  const scopeRefId = params.get('scopeRefId');
  const update = (next) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) v == null ? sp.delete(k) : sp.set(k, v);
    router.replace(`${pathname}?${sp.toString()}`);
  };
  return (
    <Tabs value={tab} onValueChange={(v) => update({ tab: v })}>
      <TabsList className="mb-4">
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="flags">Feature flags</TabsTrigger>
        <TabsTrigger value="versions">App versions</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="settings">
        <SettingsTab
          scope={scope}
          scopeRefId={scopeRefId}
          onScopeChange={(s, id) => update({ scope: s, scopeRefId: id })}
        />
      </TabsContent>
      <TabsContent value="flags">
        <FlagsTab />
      </TabsContent>
      <TabsContent value="versions">
        <VersionsTab />
      </TabsContent>
      <TabsContent value="history">
        <HistoryTab />
      </TabsContent>
    </Tabs>
  );
}

export default function ConfigurationPage() {
  return (
    <>
      <PageHeader
        title="Configuration"
        description="Business rules live here, not in code. The most specific value wins: Global → Country → State → City → Zone → Restaurant (Phase 2)."
      />
      <Suspense>
        <ConfigurationContent />
      </Suspense>
    </>
  );
}
