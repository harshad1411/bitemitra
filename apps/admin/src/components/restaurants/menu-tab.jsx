'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { formatPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { FormField } from '@/components/jamzo/form-field';
import { FoodTypeMark } from '@/components/jamzo/food-type';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState, ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api, apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApiMutation } from '@/lib/mutation';
import { availabilityText } from '@/lib/restaurants';

function SectionDialog({ restaurantId, section, onClose }) {
  const [name, setName] = useState(section?.name ?? '');
  const [isActive, setActive] = useState(section?.isActive ?? true);
  const m = useApiMutation({
    mutationFn: () =>
      section
        ? api.patch(`/v1/admin/menu-categories/${section.id}`, { name, isActive })
        : api.post(`/v1/admin/restaurants/${restaurantId}/menu-categories`, { name, isActive }),
    invalidate: [['menu', restaurantId]],
    success: section ? 'Section saved' : 'Section added',
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{section ? `Edit ${section.name}` : 'Add a menu section'}</DialogTitle>
        </DialogHeader>
        <form id="section-form" className="grid gap-3" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
          <FormField id="s-name" label="Section name" errors={m.fieldErrors.name}>
            {(a) => (
              <Input {...a} value={name} onChange={(e) => setName(e.target.value)} placeholder="Starters" />
            )}
          </FormField>
          <div className="flex items-center gap-2">
            <Switch id="s-active" checked={isActive} onCheckedChange={setActive} />
            <Label htmlFor="s-active">Shown on the menu</Label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="section-form" disabled={m.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductRow({ p, restaurantId, timeZone, editable }) {
  const a = availabilityText(p.availability, timeZone);
  const toggle = useApiMutation({
    mutationFn: (isAvailable) => api.post(`/v1/admin/products/${p.id}/availability`, { isAvailable }),
    invalidate: [['menu', restaurantId], ['products']],
    success: (r) => `${r.name}: ${r.availability.available ? 'available' : 'sold out'}`,
  });
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="size-10 shrink-0 overflow-hidden rounded bg-muted">
        {p.image ? (
          <img
            src={apiUrl(p.image.urls.thumb ?? p.image.urls.original)}
            alt=""
            className="size-full object-cover"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <Link href={`/products/${p.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
          <FoodTypeMark type={p.foodType} /> {p.name}
        </Link>
        <p className="text-xs text-muted-foreground">
          {p.variants.length
            ? `from ${formatPaise(p.basePricePaise)} · ${p.variants.length} sizes`
            : formatPaise(p.basePricePaise)}
          {p.addonGroups.length
            ? ` · ${p.addonGroups.length} add-on group${p.addonGroups.length > 1 ? 's' : ''}`
            : ''}
          {p.isBestseller ? ' · Bestseller' : ''}
        </p>
      </div>
      <StatusBadge tone={a.tone}>{a.text}</StatusBadge>
      {editable && p.status === 'ACTIVE' ? (
        <Switch
          aria-label={`${p.name} in stock`}
          checked={p.isAvailable && p.availability.reason !== 'SOLD_OUT_UNTIL'}
          disabled={toggle.isPending}
          onCheckedChange={(v) => toggle.mutate(v)}
        />
      ) : null}
    </li>
  );
}

export function MenuTab({ restaurant }) {
  const { can } = useAuth();
  const editable = can('products.manage');
  const [dialog, setDialog] = useState(null); // 'new' | section
  const [deleting, setDeleting] = useState(null);
  const menu = useQuery({
    queryKey: ['menu', restaurant.id],
    queryFn: () => api.get(`/v1/admin/restaurants/${restaurant.id}/menu`),
  });
  const reorder = useApiMutation({
    mutationFn: (ids) => api.put(`/v1/admin/restaurants/${restaurant.id}/menu-categories/order`, { ids }),
    invalidate: [['menu', restaurant.id]],
  });
  const remove = useApiMutation({
    mutationFn: (id) => api.delete(`/v1/admin/menu-categories/${id}`),
    invalidate: [['menu', restaurant.id]],
    success: 'Section deleted',
    onSuccess: () => setDeleting(null),
  });
  if (menu.isPending) return <LoadingRows />;
  if (menu.isError) return <ErrorState error={menu.error} onRetry={() => menu.refetch()} />;
  const { sections, unsectioned } = menu.data;
  const move = (i, dir) => {
    const ids = sections.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    reorder.mutate(ids);
  };
  const groups = [
    ...sections,
    ...(unsectioned.length
      ? [{ id: null, name: 'Not in a section', isActive: true, products: unsectioned }]
      : []),
  ];

  return (
    <div className="grid gap-4">
      {editable ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setDialog('new')}>
            <Plus /> Add section
          </Button>
          <Button asChild>
            <Link href={`/products/new?restaurantId=${restaurant.id}`}>
              <Plus /> Add product
            </Link>
          </Button>
        </div>
      ) : null}
      {!groups.length ? (
        <Card>
          <EmptyState
            icon={UtensilsCrossed}
            title="No menu yet"
            description="Add sections such as “Starters” or “Thalis”, then add products to them."
          />
        </Card>
      ) : null}
      {groups.map((s, i) => (
        <Card key={s.id ?? 'none'}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {s.name}{' '}
              <span className="text-sm font-normal text-muted-foreground">({s.products.length})</span>
              {!s.isActive ? <StatusBadge>Hidden</StatusBadge> : null}
            </CardTitle>
            {editable && s.id ? (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${s.name} up`}
                  disabled={i === 0 || reorder.isPending}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${s.name} down`}
                  disabled={i === sections.length - 1 || reorder.isPending}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${s.name}`}
                  onClick={() => setDialog(s)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${s.name}`}
                  onClick={() => setDeleting(s)}
                >
                  <Trash2 />
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            {s.products.length ? (
              <ul className="divide-y">
                {s.products.map((p) => (
                  <ProductRow
                    key={p.id}
                    p={p}
                    restaurantId={restaurant.id}
                    timeZone={restaurant.city.timezone}
                    editable={editable}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No products in this section.</p>
            )}
          </CardContent>
        </Card>
      ))}
      {dialog ? (
        <SectionDialog
          restaurantId={restaurant.id}
          section={dialog === 'new' ? null : dialog}
          onClose={() => setDialog(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete the section “${deleting?.name}”?`}
        description="Only empty sections can be deleted. Move or archive its products first."
        confirmLabel="Delete section"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting.id)}
      />
    </div>
  );
}
