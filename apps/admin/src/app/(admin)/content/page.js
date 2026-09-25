'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import { paiseToRupeeInput, parseRupeesToPaise } from '@jamzo/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/jamzo/page-header';
import { FormField } from '@/components/jamzo/form-field';
import { PriceInput } from '@/components/jamzo/price-input';
import { MediaPicker } from '@/components/jamzo/media-picker';
import { StatusBadge } from '@/components/jamzo/status-badge';
import { ConfirmDialog } from '@/components/jamzo/confirm-dialog';
import { EmptyState, ErrorState, LoadingRows } from '@/components/jamzo/states';
import { api, apiUrl } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { slugify } from '@/lib/format';

const TYPES = [
  ['BANNER_CAROUSEL', 'Banner carousel'],
  ['CATEGORIES', 'Food categories'],
  ['RECOMMENDED', 'Recommended restaurants'],
  ['TOP_RESTAURANTS', 'Top restaurants'],
  ['POPULAR_NEAR_YOU', 'Popular near you'],
  ['OFFERS', 'Restaurants with offers'],
  ['NEW_RESTAURANTS', 'New restaurants'],
  ['FREE_DELIVERY', 'Free delivery'],
  ['TOP_RATED', 'Top rated (needs ratings, Phase 5)'],
  ['CUISINE_COLLECTION', 'Cuisine collection'],
  ['RESTAURANT_COLLECTION', 'Chosen restaurants'],
  ['UNDER_PRICE', 'Dishes under a price'],
  ['IMAGE_PROMO', 'Image promotion'],
  ['TEXT', 'Text'],
];
const typeLabel = (t) => TYPES.find(([v]) => v === t)?.[1] ?? t;

function SectionDialog({ section, onClose }) {
  const restaurants = useQuery({
    queryKey: ['restaurants', 'options', 'ACTIVE'],
    queryFn: () => api.get('/v1/admin/restaurants', { limit: 100, status: 'ACTIVE' }),
  });
  const cfg = section?.config ?? {};
  const [f, setF] = useState({
    type: section?.type ?? 'RECOMMENDED',
    title: section?.title ?? '',
    subtitle: section?.subtitle ?? '',
    ctaLabel: section?.ctaLabel ?? '',
    deepLink: section?.deepLink ?? '',
    limit: String(cfg.limit ?? 10),
    cuisine: cfg.cuisine ?? '',
    maxPrice: cfg.maxPricePaise ? paiseToRupeeInput(cfg.maxPricePaise) : '',
    restaurantIds: cfg.restaurantIds ?? [],
    mediaId: section?.mediaId ?? null,
    image: section?.image ?? null,
    isEnabled: section?.isEnabled ?? true,
  });
  const [picking, setPicking] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const m = useApiMutation({
    mutationFn: () => {
      const body = {
        type: f.type,
        title: f.title || null,
        subtitle: f.subtitle || null,
        ctaLabel: f.ctaLabel || null,
        deepLink: f.deepLink || null,
        mediaId: f.mediaId,
        config: {
          limit: Number(f.limit) || undefined,
          ...(f.type === 'CUISINE_COLLECTION' ? { cuisine: f.cuisine } : {}),
          ...(f.type === 'UNDER_PRICE' ? { maxPricePaise: parseRupeesToPaise(f.maxPrice) ?? undefined } : {}),
          ...(f.type === 'RESTAURANT_COLLECTION' ? { restaurantIds: f.restaurantIds } : {}),
        },
        isEnabled: f.isEnabled,
      };
      return section
        ? api.put(`/v1/admin/cms/home-sections/${section.id}`, body)
        : api.post('/v1/admin/cms/home-sections', body);
    },
    invalidate: [['cms']],
    success: 'Home section saved',
    onSuccess: onClose,
  });
  const err = (k) =>
    Object.entries(m.fieldErrors)
      .filter(([key]) => key === k || key.startsWith(`${k}.`))
      .flatMap(([, v]) => v);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{section ? 'Edit home section' : 'New home section'}</DialogTitle>
          <DialogDescription>
            Restaurant and dish sections are filled per customer location: only places that deliver there
            appear.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <FormField id="hs-type" label="Section type">
            <Select value={f.type} onValueChange={set('type')}>
              <SelectTrigger id="hs-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField id="hs-title" label="Title" errors={err('title')}>
            {(a) => <Input {...a} value={f.title} onChange={set('title')} />}
          </FormField>
          <FormField id="hs-subtitle" label="Subtitle (optional)">
            {(a) => <Input {...a} value={f.subtitle} onChange={set('subtitle')} />}
          </FormField>
          {['BANNER_CAROUSEL', 'IMAGE_PROMO', 'TEXT'].includes(f.type) ? null : (
            <FormField id="hs-limit" label="How many to show">
              {(a) => <Input {...a} inputMode="numeric" value={f.limit} onChange={set('limit')} />}
            </FormField>
          )}
          {f.type === 'CUISINE_COLLECTION' ? (
            <FormField id="hs-cuisine" label="Cuisine" errors={err('config.cuisine')}>
              {(a) => <Input {...a} value={f.cuisine} onChange={set('cuisine')} placeholder="Thali" />}
            </FormField>
          ) : null}
          {f.type === 'UNDER_PRICE' ? (
            <FormField id="hs-max" label="Customer price up to" errors={err('config.maxPricePaise')}>
              {(a) => <PriceInput {...a} value={f.maxPrice} onChange={set('maxPrice')} />}
            </FormField>
          ) : null}
          {f.type === 'RESTAURANT_COLLECTION' ? (
            <fieldset className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2">
              <legend className="px-1 text-sm">
                Restaurants{' '}
                {err('config.restaurantIds').length ? (
                  <span className="text-destructive">— {err('config.restaurantIds').join(' ')}</span>
                ) : null}
              </legend>
              {(restaurants.data?.items ?? []).map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`hs-r-${r.id}`}
                    checked={f.restaurantIds.includes(r.id)}
                    onCheckedChange={(v) =>
                      set('restaurantIds')(
                        v ? [...f.restaurantIds, r.id] : f.restaurantIds.filter((x) => x !== r.id),
                      )
                    }
                  />
                  <Label htmlFor={`hs-r-${r.id}`} className="font-normal">
                    {r.name}
                  </Label>
                </div>
              ))}
            </fieldset>
          ) : null}
          {f.type === 'IMAGE_PROMO' ? (
            <div className="flex items-center gap-3">
              {f.image ? (
                <img
                  src={apiUrl(f.image.thumb ?? f.image.original)}
                  alt=""
                  className="size-16 rounded object-cover"
                />
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
                <ImagePlus /> {f.mediaId ? 'Change image' : 'Choose image'}
              </Button>
              {err('mediaId').length ? (
                <span className="text-xs text-destructive">{err('mediaId').join(' ')}</span>
              ) : null}
            </div>
          ) : null}
          {['IMAGE_PROMO', 'TEXT'].includes(f.type) ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField id="hs-cta" label="Button label (optional)">
                {(a) => <Input {...a} value={f.ctaLabel} onChange={set('ctaLabel')} />}
              </FormField>
              <FormField id="hs-link" label="Link (optional)">
                {(a) => (
                  <Input {...a} value={f.deepLink} onChange={set('deepLink')} placeholder="jamzo://offers" />
                )}
              </FormField>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Switch id="hs-enabled" checked={f.isEnabled} onCheckedChange={set('isEnabled')} />
            <Label htmlFor="hs-enabled">Shown in the app</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            Save
          </Button>
        </DialogFooter>
        {picking ? (
          <MediaPicker
            open
            onOpenChange={setPicking}
            onSelect={(md) => md && setF((s) => ({ ...s, mediaId: md.id, image: md.urls }))}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BannerAdder({ section }) {
  const [picking, setPicking] = useState(false);
  const m = useApiMutation({
    mutationFn: (media) =>
      api.post('/v1/admin/cms/banners', {
        homeSectionId: section.id,
        mediaId: media.id,
        title: media.title ?? null,
      }),
    invalidate: [['cms']],
    success: 'Banner added',
  });
  return (
    <>
      <Button variant="link" size="sm" onClick={() => setPicking(true)} disabled={m.isPending}>
        <ImagePlus /> Add banner
      </Button>
      {picking ? <MediaPicker open onOpenChange={setPicking} onSelect={(md) => md && m.mutate(md)} /> : null}
    </>
  );
}

function SectionsTab() {
  const [dialog, setDialog] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const sections = useQuery({
    queryKey: ['cms', 'sections'],
    queryFn: () => api.get('/v1/admin/cms/home-sections'),
  });
  const banners = useQuery({ queryKey: ['cms', 'banners'], queryFn: () => api.get('/v1/admin/cms/banners') });
  const reorder = useApiMutation({
    mutationFn: (ids) => api.put('/v1/admin/cms/home-sections/order', { ids }),
    invalidate: [['cms']],
  });
  const remove = useApiMutation({
    mutationFn: (id) => api.delete(`/v1/admin/cms/home-sections/${id}`),
    invalidate: [['cms']],
    success: 'Section deleted',
    onSuccess: () => setDeleting(null),
  });
  const removeBanner = useApiMutation({
    mutationFn: (id) => api.delete(`/v1/admin/cms/banners/${id}`),
    invalidate: [['cms']],
    success: 'Banner removed',
  });
  if (sections.isPending) return <LoadingRows />;
  if (sections.isError) return <ErrorState error={sections.error} onRetry={() => sections.refetch()} />;
  const items = sections.data.items;
  const move = (i, d) => {
    const ids = items.map((s) => s.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    reorder.mutate(ids);
  };
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setDialog({})}>
          <Plus /> Add section
        </Button>
      </div>
      {!items.length ? (
        <Card>
          <EmptyState
            icon={LayoutTemplate}
            title="No home sections"
            description="Without sections the app shows every restaurant that delivers to the customer."
          />
        </Card>
      ) : null}
      {items.map((s, i) => (
        <Card key={s.id}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 py-3">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {s.title || typeLabel(s.type)}{' '}
              <span className="text-xs font-normal text-muted-foreground">{typeLabel(s.type)}</span>
              {!s.isEnabled ? <StatusBadge>Hidden</StatusBadge> : null}
            </CardTitle>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move ${s.title || s.type} up`}
                disabled={i === 0 || reorder.isPending}
                onClick={() => move(i, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move ${s.title || s.type} down`}
                disabled={i === items.length - 1 || reorder.isPending}
                onClick={() => move(i, 1)}
              >
                <ArrowDown />
              </Button>
              <Button variant="link" size="sm" onClick={() => setDialog({ section: s })}>
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${s.title || s.type}`}
                onClick={() => setDeleting(s)}
              >
                <Trash2 />
              </Button>
            </div>
          </CardHeader>
          {s.type === 'BANNER_CAROUSEL' ? (
            <CardContent className="flex flex-wrap items-center gap-2">
              {(banners.data?.items ?? [])
                .filter((b) => b.homeSectionId === s.id)
                .map((b) => (
                  <div key={b.id} className="relative">
                    {b.image ? (
                      <img
                        src={apiUrl(b.image.thumb ?? b.image.original)}
                        alt={b.title ?? ''}
                        className="h-16 w-28 rounded object-cover"
                      />
                    ) : null}
                    <button
                      type="button"
                      className="absolute top-1 right-1 rounded bg-background/90 p-0.5"
                      aria-label={`Remove banner ${b.title ?? ''}`}
                      onClick={() => removeBanner.mutate(b.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              <BannerAdder section={s} />
            </CardContent>
          ) : null}
        </Card>
      ))}
      {dialog ? <SectionDialog section={dialog.section} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this home section?"
        confirmLabel="Delete"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate(deleting.id)}
      />
    </div>
  );
}

function PageDialog({ page, onClose }) {
  const full = useQuery({
    queryKey: ['cms', 'page', page?.id],
    queryFn: () => api.get(`/v1/admin/cms/pages/${page.id}`),
    enabled: Boolean(page),
  });
  const [f, setF] = useState(null);
  const form =
    f ??
    (page
      ? full.data
        ? {
            slug: full.data.slug,
            title: full.data.title,
            body: full.data.body,
            isPublished: full.data.isPublished,
          }
        : null
      : { slug: '', title: '', body: '', isPublished: false });
  const m = useApiMutation({
    mutationFn: () =>
      page ? api.put(`/v1/admin/cms/pages/${page.id}`, form) : api.post('/v1/admin/cms/pages', form),
    invalidate: [['cms']],
    success: 'Page saved',
    onSuccess: onClose,
  });
  const set = (k) => (v) => setF({ ...form, [k]: v?.target ? v.target.value : v });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{page ? `Edit ${page.title}` : 'New page'}</DialogTitle>
          <DialogDescription>
            Markdown. Legal pages (terms, privacy, refunds) need text from counsel before publishing (Q-12).
          </DialogDescription>
        </DialogHeader>
        {!form ? (
          <LoadingRows rows={3} columns={1} />
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField id="pg-title" label="Title" errors={m.fieldErrors.title}>
                {(a) => (
                  <Input
                    {...a}
                    value={form.title}
                    onChange={(e) =>
                      setF({
                        ...form,
                        title: e.target.value,
                        ...(page ? {} : { slug: slugify(e.target.value) }),
                      })
                    }
                  />
                )}
              </FormField>
              <FormField id="pg-slug" label="Slug" errors={m.fieldErrors.slug}>
                {(a) => <Input {...a} value={form.slug} onChange={set('slug')} />}
              </FormField>
            </div>
            <FormField id="pg-body" label="Text (Markdown)" errors={m.fieldErrors.body}>
              {(a) => (
                <Textarea
                  {...a}
                  rows={12}
                  className="font-mono text-xs"
                  value={form.body}
                  onChange={set('body')}
                />
              )}
            </FormField>
            <div className="flex items-center gap-2">
              <Switch id="pg-published" checked={form.isPublished} onCheckedChange={set('isPublished')} />
              <Label htmlFor="pg-published">Published (visible in the apps)</Label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={!form || m.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PagesTab() {
  const [dialog, setDialog] = useState(null);
  const q = useQuery({ queryKey: ['cms', 'pages'], queryFn: () => api.get('/v1/admin/cms/pages') });
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setDialog({})}>
          <Plus /> New page
        </Button>
      </div>
      <Card className="overflow-hidden py-0">
        {q.isPending ? (
          <LoadingRows />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.items ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.title}</TableCell>
                  <TableCell className="font-mono text-xs">{p.slug}</TableCell>
                  <TableCell>
                    {p.isPublished ? (
                      <StatusBadge tone="success">Published</StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">Draft</StatusBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="link" size="sm" onClick={() => setDialog({ page: p })}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {dialog ? <PageDialog page={dialog.page} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

export default function ContentPage() {
  return (
    <>
      <PageHeader
        title="Home & content"
        description="The customer app’s home screen, banners and static pages. Sections can be ordered, hidden and targeted."
      />
      <Tabs defaultValue="home">
        <TabsList className="mb-4">
          <TabsTrigger value="home">Home screen</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
        </TabsList>
        <TabsContent value="home">
          <SectionsTab />
        </TabsContent>
        <TabsContent value="pages">
          <PagesTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
