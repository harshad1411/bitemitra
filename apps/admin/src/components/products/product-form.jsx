'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { paiseToRupeeInput, parseRupeesToPaise } from '@jamzo/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/jamzo/form-field';
import { PriceInput } from '@/components/jamzo/price-input';
import { MediaPicker } from '@/components/jamzo/media-picker';
import { FOOD_TYPE_OPTIONS } from '@/components/jamzo/food-type';
import { api, apiUrl } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import { DAYS } from '@/lib/restaurants';

const NONE = '__none__';
const money = (p) => paiseToRupeeInput(p ?? null);

function toForm(p, restaurantId) {
  return {
    restaurantId: p?.restaurantId ?? restaurantId ?? '',
    menuCategoryId: p?.menuCategoryId ?? NONE,
    categoryId: p?.categoryId ?? NONE,
    name: p?.name ?? '',
    description: p?.description ?? '',
    foodType: p?.foodType ?? 'VEG',
    price: p && !p.variants.length ? money(p.basePricePaise) : '',
    packaging: money(p?.packagingChargePaise),
    taxInclusive: p?.taxInclusive == null ? 'INHERIT' : String(p.taxInclusive),
    prepTimeMinutes: p?.prepTimeMinutes ? String(p.prepTimeMinutes) : '',
    stockQuantity: p?.stockQuantity == null ? '' : String(p.stockQuantity),
    isBestseller: p?.isBestseller ?? false,
    isRecommended: p?.isRecommended ?? false,
    isFeatured: p?.isFeatured ?? false,
    status: p?.status ?? 'ACTIVE',
    isAvailable: p?.isAvailable ?? true,
    variants: (p?.variants ?? []).map((v) => ({ ...v, price: money(v.basePricePaise) })),
    addonGroups: (p?.addonGroups ?? []).map((g) => ({
      ...g,
      minSelect: String(g.minSelect),
      maxSelect: String(g.maxSelect),
      addons: g.addons.map((a) => ({ ...a, price: money(a.basePricePaise) })),
    })),
    images: p?.images ?? [],
    schedules: p?.schedules ?? [],
  };
}

/** Builds the API body; money text is converted exactly (no floats). Returns { body, errors }. */
function toBody(f, version) {
  const errors = {};
  const paise = (text, key, required) => {
    if (!text?.trim()) {
      if (required) errors[key] = ['Enter a price'];
      return null;
    }
    const v = parseRupeesToPaise(text);
    if (v == null) errors[key] = ['Enter an amount like 180 or 180.50'];
    return v;
  };
  const body = {
    ...(version === undefined ? { restaurantId: f.restaurantId } : { version }),
    menuCategoryId: f.menuCategoryId === NONE ? null : f.menuCategoryId,
    categoryId: f.categoryId === NONE ? null : f.categoryId,
    name: f.name,
    description: f.description || null,
    foodType: f.foodType,
    basePricePaise: f.variants.length ? null : paise(f.price, 'basePricePaise', true),
    packagingChargePaise: paise(f.packaging, 'packagingChargePaise', false),
    taxInclusive: f.taxInclusive === 'INHERIT' ? null : f.taxInclusive === 'true',
    prepTimeMinutes: f.prepTimeMinutes ? Number(f.prepTimeMinutes) : null,
    stockQuantity: f.stockQuantity === '' ? null : Number(f.stockQuantity),
    isBestseller: f.isBestseller,
    isRecommended: f.isRecommended,
    isFeatured: f.isFeatured,
    status: f.status,
    isAvailable: f.isAvailable,
    variants: f.variants.map((v, i) => ({
      ...(v.id ? { id: v.id } : {}),
      name: v.name,
      basePricePaise: paise(v.price, `variants.${i}.basePricePaise`, true),
      isDefault: v.isDefault,
      isAvailable: v.isAvailable,
    })),
    addonGroups: f.addonGroups.map((g, gi) => ({
      ...(g.id ? { id: g.id } : {}),
      name: g.name,
      minSelect: Number(g.minSelect),
      maxSelect: Number(g.maxSelect),
      addons: g.addons.map((a, ai) => ({
        ...(a.id ? { id: a.id } : {}),
        name: a.name,
        basePricePaise: paise(a.price, `addonGroups.${gi}.addons.${ai}.basePricePaise`, false) ?? 0,
        foodType: a.foodType,
        isAvailable: a.isAvailable,
      })),
    })),
    imageMediaIds: f.images.map((i) => i.mediaId),
    schedules: f.schedules,
  };
  return { body, errors };
}

const errorsUnder = (errors, prefix) =>
  Object.entries(errors)
    .filter(([k]) => k === prefix || k.startsWith(`${prefix}.`))
    .flatMap(([, v]) => v);

function Toggle({ id, label, checked, onChange, help }) {
  return (
    <div className="flex items-start gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="grid gap-0.5 font-normal">
        <span>{label}</span>
        {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
      </Label>
    </div>
  );
}

export function ProductForm({ product, restaurantId: initialRestaurant }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [f, setF] = useState(() => toForm(product, initialRestaurant));
  const [localErrors, setLocalErrors] = useState({});
  const [picking, setPicking] = useState(false);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v?.target ? v.target.value : v }));
  const restaurants = useQuery({
    queryKey: ['restaurants', 'options'],
    queryFn: () => api.get('/v1/admin/restaurants', { limit: 100 }),
    enabled: !product,
  });
  const menu = useQuery({
    queryKey: ['menu', f.restaurantId],
    queryFn: () => api.get(`/v1/admin/restaurants/${f.restaurantId}/menu`),
    enabled: Boolean(f.restaurantId),
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/v1/admin/categories') });

  const save = useApiMutation({
    mutationFn: (body) =>
      product ? api.put(`/v1/admin/products/${product.id}`, body) : api.post('/v1/admin/products', body),
    invalidate: [['products'], ['menu'], ['restaurant']],
    success: (p) => `${p.name} saved`,
    onSuccess: (p) => {
      qc.setQueryData(['product', p.id], p);
      if (!product) router.replace(`/products/${p.id}`);
      else setF(toForm(p));
    },
  });
  const errors = { ...save.fieldErrors, ...localErrors };
  const conflict = save.error?.code === 'CONFLICT' && save.error?.details?.currentVersion !== undefined;

  const submit = () => {
    const { body, errors: e } = toBody(f, product?.version);
    setLocalErrors(e);
    if (Object.keys(e).length) return;
    save.mutate(body);
  };

  // Variants
  const setVariant = (i, patch) =>
    setF((s) => ({ ...s, variants: s.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const addVariant = () =>
    setF((s) => {
      const fresh = s.variants.length
        ? [...s.variants, { name: '', price: '', isDefault: false, isAvailable: true }]
        : [
            { name: 'Regular', price: s.price, isDefault: true, isAvailable: true },
            { name: '', price: '', isDefault: false, isAvailable: true },
          ];
      return { ...s, variants: fresh };
    });
  // Add-on groups
  const setGroup = (gi, patch) =>
    setF((s) => ({ ...s, addonGroups: s.addonGroups.map((g, j) => (j === gi ? { ...g, ...patch } : g)) }));
  const setAddon = (gi, ai, patch) =>
    setGroup(gi, { addons: f.addonGroups[gi].addons.map((a, j) => (j === ai ? { ...a, ...patch } : a)) });

  const sections = menu.data?.sections ?? [];
  const restaurant = product?.restaurant ?? restaurants.data?.items.find((r) => r.id === f.restaurantId);

  return (
    <form
      className="grid gap-4 lg:grid-cols-[1fr_20rem]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid content-start gap-4">
        {conflict ? (
          <Alert variant="destructive">
            <AlertTitle>Someone else saved this product</AlertTitle>
            <AlertDescription>
              Your changes were not saved, so nothing was overwritten.
              <Button
                type="button"
                variant="link"
                className="h-auto px-1"
                onClick={() => window.location.reload()}
              >
                Reload to see the latest version
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <FormField id="p-name" label="Name" errors={errors.name}>
              {(a) => <Input {...a} value={f.name} onChange={set('name')} />}
            </FormField>
            <FormField id="p-description" label="Description" errors={errors.description}>
              {(a) => <Textarea {...a} rows={3} value={f.description} onChange={set('description')} />}
            </FormField>
            <FormField id="p-foodType" label="Food type" errors={errors.foodType}>
              <Select value={f.foodType} onValueChange={set('foodType')}>
                <SelectTrigger id="p-foodType" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FOOD_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Images</CardTitle>
              <CardDescription>The first image is the main one. Up to 10.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setPicking(true)}>
              <ImagePlus /> Choose images
            </Button>
          </CardHeader>
          <CardContent>
            {f.images.length ? (
              <ul className="flex flex-wrap gap-2">
                {f.images.map((img, i) => (
                  <li key={img.mediaId} className="relative size-24 overflow-hidden rounded-md border">
                    <img
                      src={apiUrl(img.urls.thumb ?? img.urls.original)}
                      alt=""
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      className="absolute top-1 right-1 rounded-full bg-background/90 p-0.5"
                      aria-label={`Remove image ${i + 1}`}
                      onClick={() =>
                        setF((s) => ({ ...s, images: s.images.filter((x) => x.mediaId !== img.mediaId) }))
                      }
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No images yet.</p>
            )}
            {errors.imageMediaIds ? (
              <p className="mt-1 text-xs text-destructive">{errors.imageMediaIds.join(' ')}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Price &amp; sizes</CardTitle>
            <CardDescription>
              The restaurant’s own price. The customer price (markup, tax, fees) is calculated by the pricing
              engine from Phase 4 — a preview will appear here then.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {!f.variants.length ? (
              <FormField id="p-price" label="Price" errors={errors.basePricePaise}>
                {(a) => <PriceInput {...a} className="w-40" value={f.price} onChange={set('price')} />}
              </FormField>
            ) : (
              <div className="grid gap-2" role="group" aria-label="Sizes">
                {errors.variants ? (
                  <p className="text-xs text-destructive">{errors.variants.join(' ')}</p>
                ) : null}
                {f.variants.map((v, i) => (
                  <div key={v.id ?? `new-${i}`} className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label={`Size ${i + 1} name`}
                        className="w-40"
                        value={v.name}
                        placeholder="Half / Full / 10 inch"
                        onChange={(e) => setVariant(i, { name: e.target.value })}
                      />
                      <PriceInput
                        aria-label={`Size ${i + 1} price`}
                        className="w-32"
                        value={v.price}
                        onChange={(price) => setVariant(i, { price })}
                      />
                      <label className="flex items-center gap-1 text-sm">
                        <input
                          type="radio"
                          name="default-variant"
                          checked={v.isDefault}
                          onChange={() =>
                            setF((s) => ({
                              ...s,
                              variants: s.variants.map((x, j) => ({ ...x, isDefault: j === i })),
                            }))
                          }
                        />
                        Default
                      </label>
                      <label className="flex items-center gap-1 text-sm">
                        <Switch
                          aria-label={`Size ${i + 1} available`}
                          checked={v.isAvailable}
                          onCheckedChange={(isAvailable) => setVariant(i, { isAvailable })}
                        />
                        In stock
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove size ${i + 1}`}
                        onClick={() =>
                          setF((s) => ({ ...s, variants: s.variants.filter((_, j) => j !== i) }))
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    {errorsUnder(errors, `variants.${i}`).length ? (
                      <p className="text-xs text-destructive">
                        {errorsUnder(errors, `variants.${i}`).join(' ')}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={addVariant}>
                <Plus /> {f.variants.length ? 'Add size' : 'Sell in different sizes'}
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                id="p-packaging"
                label="Packaging charge per item"
                help="Empty = restaurant/city default. Passed to the restaurant, no markup."
                errors={errors.packagingChargePaise}
              >
                {(a) => <PriceInput {...a} value={f.packaging} onChange={set('packaging')} />}
              </FormField>
              <FormField
                id="p-tax"
                label="Price includes tax?"
                help="Empty = tax rules decide (pending CA review, Q-3)."
                errors={errors.taxInclusive}
              >
                <Select value={f.taxInclusive} onValueChange={set('taxInclusive')}>
                  <SelectTrigger id="p-tax" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INHERIT">Use the tax rules</SelectItem>
                    <SelectItem value="true">Yes, tax included</SelectItem>
                    <SelectItem value="false">No, tax added</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Add-ons &amp; choices</CardTitle>
            <CardDescription>
              Groups such as “Extra toppings” (choose up to 3) or a required “Regular / Jain” choice (minimum
              1, maximum 1).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {f.addonGroups.map((g, gi) => (
              <fieldset key={g.id ?? `g-${gi}`} className="grid gap-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Group {gi + 1}</legend>
                <div className="flex flex-wrap items-end gap-2">
                  <FormField id={`g-${gi}-name`} label="Group name" errors={errors[`addonGroups.${gi}.name`]}>
                    {(a) => (
                      <Input
                        {...a}
                        className="w-56"
                        value={g.name}
                        onChange={(e) => setGroup(gi, { name: e.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField
                    id={`g-${gi}-min`}
                    label="Minimum"
                    errors={errors[`addonGroups.${gi}.minSelect`]}
                  >
                    {(a) => (
                      <Input
                        {...a}
                        className="w-20"
                        inputMode="numeric"
                        value={g.minSelect}
                        onChange={(e) => setGroup(gi, { minSelect: e.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField
                    id={`g-${gi}-max`}
                    label="Maximum"
                    errors={errors[`addonGroups.${gi}.maxSelect`]}
                  >
                    {(a) => (
                      <Input
                        {...a}
                        className="w-20"
                        inputMode="numeric"
                        value={g.maxSelect}
                        onChange={(e) => setGroup(gi, { maxSelect: e.target.value })}
                      />
                    )}
                  </FormField>
                  <div className="ml-auto flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move group ${gi + 1} up`}
                      disabled={gi === 0}
                      onClick={() =>
                        setF((s) => {
                          const a = [...s.addonGroups];
                          [a[gi - 1], a[gi]] = [a[gi], a[gi - 1]];
                          return { ...s, addonGroups: a };
                        })
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move group ${gi + 1} down`}
                      disabled={gi === f.addonGroups.length - 1}
                      onClick={() =>
                        setF((s) => {
                          const a = [...s.addonGroups];
                          [a[gi + 1], a[gi]] = [a[gi], a[gi + 1]];
                          return { ...s, addonGroups: a };
                        })
                      }
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove group ${gi + 1}`}
                      onClick={() =>
                        setF((s) => ({ ...s, addonGroups: s.addonGroups.filter((_, j) => j !== gi) }))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                {errors[`addonGroups.${gi}.addons`] ? (
                  <p className="text-xs text-destructive">{errors[`addonGroups.${gi}.addons`].join(' ')}</p>
                ) : null}
                {g.addons.map((a, ai) => {
                  const addonErrors = errorsUnder(errors, `addonGroups.${gi}.addons.${ai}`);
                  return (
                    <div key={a.id ?? `a-${ai}`} className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          aria-label={`Group ${gi + 1} option ${ai + 1} name`}
                          className="w-48"
                          value={a.name}
                          onChange={(e) => setAddon(gi, ai, { name: e.target.value })}
                        />
                        <PriceInput
                          aria-label={`Group ${gi + 1} option ${ai + 1} price`}
                          className="w-28"
                          value={a.price}
                          onChange={(price) => setAddon(gi, ai, { price })}
                          placeholder="0"
                        />
                        <Select
                          value={a.foodType}
                          onValueChange={(foodType) => setAddon(gi, ai, { foodType })}
                        >
                          <SelectTrigger
                            className="w-28"
                            aria-label={`Group ${gi + 1} option ${ai + 1} food type`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FOOD_TYPE_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Switch
                          aria-label={`Group ${gi + 1} option ${ai + 1} available`}
                          checked={a.isAvailable}
                          onCheckedChange={(isAvailable) => setAddon(gi, ai, { isAvailable })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove option ${ai + 1} of group ${gi + 1}`}
                          onClick={() => setGroup(gi, { addons: g.addons.filter((_, j) => j !== ai) })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      {addonErrors.length ? (
                        <p className="text-xs text-destructive">{addonErrors.join(' ')}</p>
                      ) : null}
                    </div>
                  );
                })}
                <div>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() =>
                      setGroup(gi, {
                        addons: [...g.addons, { name: '', price: '', foodType: 'VEG', isAvailable: true }],
                      })
                    }
                  >
                    <Plus /> Add option
                  </Button>
                </div>
              </fieldset>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setF((s) => ({
                    ...s,
                    addonGroups: [
                      ...s.addonGroups,
                      {
                        name: '',
                        minSelect: '0',
                        maxSelect: '1',
                        addons: [{ name: '', price: '', foodType: 'VEG', isAvailable: true }],
                      },
                    ],
                  }))
                }
              >
                <Plus /> Add a group
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>
              Leave empty to sell whenever the restaurant is open. Add windows for items like breakfast (city
              time).
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {f.schedules.map((s, i) => (
              <div key={i} className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={String(s.dayOfWeek)}
                    onValueChange={(d) =>
                      setF((st) => ({
                        ...st,
                        schedules: st.schedules.map((x, j) => (j === i ? { ...x, dayOfWeek: Number(d) } : x)),
                      }))
                    }
                  >
                    <SelectTrigger className="w-36" aria-label={`Schedule ${i + 1} day`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d, n) => (
                        <SelectItem key={d} value={String(n)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="time"
                    aria-label={`Schedule ${i + 1} from`}
                    className="w-32"
                    value={s.startsAt}
                    onChange={(e) =>
                      setF((st) => ({
                        ...st,
                        schedules: st.schedules.map((x, j) =>
                          j === i ? { ...x, startsAt: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    aria-label={`Schedule ${i + 1} until`}
                    className="w-24"
                    value={s.endsAt}
                    onChange={(e) =>
                      setF((st) => ({
                        ...st,
                        schedules: st.schedules.map((x, j) =>
                          j === i ? { ...x, endsAt: e.target.value } : x,
                        ),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove schedule ${i + 1}`}
                    onClick={() =>
                      setF((st) => ({ ...st, schedules: st.schedules.filter((_, j) => j !== i) }))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
                {errorsUnder(errors, `schedules.${i}`).length ? (
                  <p className="text-xs text-destructive">
                    {errorsUnder(errors, `schedules.${i}`).join(' ')}
                  </p>
                ) : null}
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setF((s) => ({
                    ...s,
                    schedules: [...s.schedules, { dayOfWeek: 1, startsAt: '08:00', endsAt: '11:30' }],
                  }))
                }
              >
                <Plus /> Add window
              </Button>
              {f.schedules.length === 1 ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() =>
                    setF((s) => ({
                      ...s,
                      schedules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ ...s.schedules[0], dayOfWeek: d })),
                    }))
                  }
                >
                  Same window every day
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Select value={f.status} onValueChange={set('status')}>
              <SelectTrigger aria-label="Status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active — on the menu</SelectItem>
                <SelectItem value="DRAFT">Draft — hidden</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Toggle
              id="p-available"
              label="In stock"
              checked={f.isAvailable}
              onChange={set('isAvailable')}
              help="Switch off for “sold out until further notice”. Timed sold-out is set from the menu or the partner app."
            />
            <FormField
              id="p-stock"
              label="Stock count (optional)"
              help="Leave empty unless the restaurant tracks quantities."
              errors={errors.stockQuantity}
            >
              {(a) => (
                <Input {...a} inputMode="numeric" value={f.stockQuantity} onChange={set('stockQuantity')} />
              )}
            </FormField>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Organisation</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {product ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Restaurant:</span> {product.restaurant.name}
              </p>
            ) : (
              <FormField id="p-restaurant" label="Restaurant" errors={errors.restaurantId}>
                <Select
                  value={f.restaurantId}
                  onValueChange={(v) => setF((s) => ({ ...s, restaurantId: v, menuCategoryId: NONE }))}
                >
                  <SelectTrigger id="p-restaurant" className="w-full">
                    <SelectValue placeholder="Choose a restaurant" />
                  </SelectTrigger>
                  <SelectContent>
                    {(restaurants.data?.items ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            {restaurant?.isPureVeg ? (
              <p className="text-xs text-muted-foreground">
                Pure veg restaurant: only veg and vegan items and add-ons.
              </p>
            ) : null}
            <FormField id="p-section" label="Menu section" errors={errors.menuCategoryId}>
              <Select
                value={f.menuCategoryId}
                onValueChange={set('menuCategoryId')}
                disabled={!f.restaurantId}
              >
                <SelectTrigger id="p-section" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not in a section</SelectItem>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              id="p-category"
              label="Food category"
              help="Used for discovery (e.g. “Pizza”)."
              errors={errors.categoryId}
            >
              <Select value={f.categoryId} onValueChange={set('categoryId')}>
                <SelectTrigger id="p-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {(categories.data?.items ?? [])
                    .filter((c) => c.isActive)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              id="p-prep"
              label="Preparation time (minutes, optional)"
              errors={errors.prepTimeMinutes}
            >
              {(a) => (
                <Input
                  {...a}
                  inputMode="numeric"
                  value={f.prepTimeMinutes}
                  onChange={set('prepTimeMinutes')}
                />
              )}
            </FormField>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Highlights</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Toggle id="p-best" label="Bestseller" checked={f.isBestseller} onChange={set('isBestseller')} />
            <Toggle
              id="p-rec"
              label="Recommended"
              checked={f.isRecommended}
              onChange={set('isRecommended')}
            />
            <Toggle id="p-feat" label="Featured" checked={f.isFeatured} onChange={set('isFeatured')} />
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={save.isPending || (!product && !f.restaurantId)}>
            {save.isPending ? 'Saving…' : product ? 'Save product' : 'Create product'}
          </Button>
        </div>
      </div>
      {picking ? (
        <MediaPicker
          open={picking}
          onOpenChange={setPicking}
          multiple
          max={10}
          initial={f.images.map((i) => ({ id: i.mediaId, urls: i.urls }))}
          onSelect={(list) =>
            setF((s) => ({ ...s, images: list.map((m) => ({ mediaId: m.id, urls: m.urls })) }))
          }
        />
      ) : null}
    </form>
  );
}
