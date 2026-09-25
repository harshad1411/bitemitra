'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SettingsTab } from '@/components/settings/settings-tab';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';

function Capabilities({ restaurant }) {
  const { can } = useAuth();
  const m = useApiMutation({
    mutationFn: (body) => api.patch(`/v1/admin/restaurants/${restaurant.id}/settings`, body),
    invalidate: [['restaurant', restaurant.id]],
    success: 'Saved',
  });
  const editable = can('restaurants.manage');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Restaurant capabilities</CardTitle>
        <CardDescription>Per-restaurant switches that are not inherited from the city.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-start gap-2">
          <Switch
            id="cap-auto"
            checked={restaurant.settings.autoAccept}
            disabled={!editable || m.isPending}
            onCheckedChange={(v) => m.mutate({ autoAccept: v })}
          />
          <Label htmlFor="cap-auto" className="grid gap-0.5 font-normal">
            <span className="font-medium">Accept orders automatically</span>
            <span className="text-xs text-muted-foreground">
              Takes effect when ordering launches (Phase 5).
            </span>
          </Label>
        </div>
        <div className="flex items-start gap-2">
          <Switch
            id="cap-self"
            checked={restaurant.settings.selfEditMenu}
            disabled={!editable || m.isPending}
            onCheckedChange={(v) => m.mutate({ selfEditMenu: v })}
          />
          <Label htmlFor="cap-self" className="grid gap-0.5 font-normal">
            <span className="font-medium">Restaurant may edit its own menu</span>
            <span className="text-xs text-muted-foreground">
              Not built yet: the partner app only toggles sold-out items and store status (decision D-39,
              needs your approval). Also requires the feature flag “restaurant_self_edit_menu”.
            </span>
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}

function Zones({ restaurant }) {
  const { can } = useAuth();
  const city = useQuery({
    queryKey: ['city', restaurant.city.id],
    queryFn: () => api.get(`/v1/admin/geo/cities/${restaurant.city.id}`),
  });
  const [selected, setSelected] = useState(restaurant.zones.map((z) => z.id));
  const branchZones = new Set(restaurant.branches.map((b) => b.zoneId).filter(Boolean));
  const m = useApiMutation({
    mutationFn: () => api.put(`/v1/admin/restaurants/${restaurant.id}/zones`, { zoneIds: selected }),
    invalidate: [['restaurant', restaurant.id]],
    success: 'Zones saved',
  });
  const editable = can('restaurants.manage');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Listed in zones</CardTitle>
        <CardDescription>
          Zones whose customers see this restaurant (from Phase 3). The branch’s own zone is always included.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {(city.data?.zones ?? []).map((z) => {
          const locked = branchZones.has(z.id);
          return (
            <div key={z.id} className="flex items-center gap-2">
              <Checkbox
                id={`zone-${z.id}`}
                checked={locked || selected.includes(z.id)}
                disabled={!editable || locked}
                onCheckedChange={(v) => setSelected((s) => (v ? [...s, z.id] : s.filter((x) => x !== z.id)))}
              />
              <Label htmlFor={`zone-${z.id}`} className="font-normal">
                {z.name}
                {locked ? <span className="text-xs text-muted-foreground"> (branch zone)</span> : null}
              </Label>
            </div>
          );
        })}
        {editable ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => m.mutate()} disabled={m.isPending}>
              Save zones
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RestaurantSettingsTab({ restaurant }) {
  const { can } = useAuth();
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Capabilities restaurant={restaurant} />
        <Zones restaurant={restaurant} />
      </div>
      {can('config.view') ? (
        <Card>
          <CardHeader>
            <CardTitle>Configuration overrides</CardTitle>
            <CardDescription>
              Minimum order, COD, acceptance timeout, pause limits, settlement schedule… for this restaurant
              only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsTab scope="RESTAURANT" scopeRefId={restaurant.id} fixedScope />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
