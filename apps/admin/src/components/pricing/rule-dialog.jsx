'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { paiseToRupeeInput, parseRupeesToPaise } from '@jamzo/ui';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/jamzo/form-field';
import { PriceInput } from '@/components/jamzo/price-input';
import { api } from '@/lib/api';
import { useApiMutation } from '@/lib/mutation';
import {
  bpsToPercentText,
  metresToKmText,
  parseKmToMetres,
  parsePercentToBps,
  ruleTypeLabel,
  scopesFor,
} from '@/lib/pricing';
import { TargetPicker } from './target-picker';

const money = (p) => (p == null ? '' : paiseToRupeeInput(p));
const CHARGES = [
  'FOOD',
  'PACKAGING',
  'DELIVERY_FEE',
  'PLATFORM_FEE',
  'SMALL_ORDER_FEE',
  'SURCHARGE',
  'COMMISSION',
];

function Choice({ id, label, value, onChange, options, help }) {
  return (
    <FormField id={id} label={label} help={help}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
const Text = ({ id, label, value, onChange, help, suffix, ...rest }) => (
  <FormField id={id} label={label} help={help}>
    {(a) => (
      <div className="flex items-center gap-1.5">
        <Input
          {...a}
          {...rest}
          className="tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    )}
  </FormField>
);
const Money = ({ id, label, value, onChange, help }) => (
  <FormField id={id} label={label} help={help}>
    {(a) => <PriceInput {...a} value={value} onChange={onChange} />}
  </FormField>
);

/** Initial form state (all text) from existing params, or sensible blanks per type. */
function initialForm(type, p) {
  switch (type) {
    case 'MARKUP':
      return {
        type: p?.type ?? 'PERCENTAGE',
        value: p ? (p.type === 'PERCENTAGE' ? bpsToPercentText(p.valueBps) : money(p.valuePaise)) : '',
        mode: p?.rounding?.mode ?? 'NEAREST_1',
        direction: p?.rounding?.direction ?? 'HALF_UP',
        endingDigit: String(p?.rounding?.endingDigit ?? 9),
        applyToAddons: p?.applyToAddons ?? true,
      };
    case 'COMMISSION':
      return {
        type: p?.type ?? 'PERCENTAGE',
        rate: bpsToPercentText(p?.rateBps),
        fixed: money(p?.fixedPaise),
        hybridMode: p?.hybridMode ?? 'SUM',
        basis: p?.basis ?? '',
      };
    case 'TAX':
      return p?.appliesTo === 'WITHHOLDING'
        ? {
            appliesTo: 'WITHHOLDING',
            kind: p.kind,
            rate: bpsToPercentText(p.rateBps),
            base: p.base,
            enabled: p.enabled,
          }
        : {
            appliesTo: p?.appliesTo ?? 'FOOD',
            mode: p?.mode ?? 'EXCLUSIVE',
            components: (
              p?.components ?? [
                { code: 'CGST', rateBps: 250 },
                { code: 'SGST', rateBps: 250 },
              ]
            ).map((c) => ({ code: c.code, rate: bpsToPercentText(c.rateBps) })),
            liableParty: p?.liableParty ?? 'PLATFORM',
            kind: 'GST_TCS',
            rate: '',
            base: 'FOOD_VALUE',
            enabled: false,
          };
    case 'DELIVERY':
      return {
        strategy: p?.strategy ?? 'SLABS',
        slabs: (p?.slabs ?? [{ upToM: 2000, feePaise: 2000 }]).map((s) => ({
          upTo: metresToKmText(s.upToM),
          fee: money(s.feePaise),
        })),
        base: money(p?.basePaise),
        included: metresToKmText(p?.includedM ?? 0),
        perKm: money(p?.perKmPaise),
        unit: String(p?.billingUnitM ?? 100),
        flat: money(p?.flatPaise),
        min: money(p?.minPaise),
        max: money(p?.maxPaise),
        maxDistance: metresToKmText(p?.maxDistanceM ?? 7000),
        freeAbove: money(p?.freeAboveSubtotalPaise),
        smallBelow: money(p?.smallOrder?.belowSubtotalPaise),
        smallFee: money(p?.smallOrder?.feePaise),
      };
    case 'PLATFORM_FEE':
      return {
        enabled: p?.enabled ?? true,
        fixed: money(p?.fixedPaise ?? 0),
        rate: bpsToPercentText(p?.rateBps ?? 0),
        min: money(p?.minPaise),
        max: money(p?.maxPaise),
      };
    case 'SURGE':
      return {
        type: p?.type ?? 'FIXED',
        value: p
          ? p.type === 'FIXED'
            ? money(p.value)
            : p.type === 'PERCENTAGE'
              ? bpsToPercentText(p.value)
              : String(p.value / 10000)
          : '',
        start: p?.window?.start ?? '',
        end: p?.window?.end ?? '',
        applyWhenDeliveryFree: p?.applyWhenDeliveryFree ?? true,
      };
    case 'RIDER_EARNING':
      return {
        base: money(p?.basePaise),
        included: metresToKmText(p?.includedM ?? 2000),
        perKm: money(p?.perKmPaise),
        min: money(p?.minPaise ?? 0),
        waitingFree: String(p?.waitingFreeMin ?? 10),
        waitingPerMin: money(p?.waitingPerMinPaise ?? 0),
        incentives: (p?.incentives ?? []).map((i) => ({
          kind: i.kind,
          type: i.type,
          value: i.type === 'FIXED' ? money(i.value) : bpsToPercentText(i.value),
          start: i.window?.start ?? '',
          end: i.window?.end ?? '',
        })),
      };
    default:
      return {};
  }
}

/** Converts the form to API params; problems are returned instead of guessed. */
function toParams(type, f) {
  const errors = [];
  const rs = (v, label, required = true) => {
    if (!v?.trim()) return required ? (errors.push(`${label}: enter an amount`), undefined) : undefined;
    const x = parseRupeesToPaise(v);
    if (x == null) errors.push(`${label}: use an amount like 20 or 20.50`);
    return x ?? undefined;
  };
  const pc = (v, label) => {
    const x = parsePercentToBps(v);
    if (x == null) errors.push(`${label}: use a percentage like 5 or 12.5`);
    return x ?? undefined;
  };
  const km = (v, label) => {
    const x = parseKmToMetres(v);
    if (x == null) errors.push(`${label}: use kilometres like 2 or 2.5`);
    return x ?? undefined;
  };
  const windowOf = (start, end) => (start || end ? { start, end } : undefined);
  let params;
  switch (type) {
    case 'MARKUP':
      params = {
        type: f.type,
        ...(f.type === 'PERCENTAGE'
          ? { valueBps: pc(f.value, 'Markup') }
          : { valuePaise: rs(f.value, 'Markup') }),
        rounding: {
          mode: f.mode,
          direction: f.direction,
          ...(f.mode === 'PSYCHOLOGICAL' ? { endingDigit: Number(f.endingDigit) } : {}),
        },
        applyToAddons: f.applyToAddons,
      };
      break;
    case 'COMMISSION':
      params = {
        type: f.type,
        ...(f.type !== 'FIXED' ? { rateBps: pc(f.rate, 'Rate') } : {}),
        ...(f.type !== 'PERCENTAGE' ? { fixedPaise: rs(f.fixed, 'Fixed amount') } : {}),
        hybridMode: f.hybridMode,
        basis: f.basis || undefined,
      };
      if (!f.basis) errors.push('Choose the commission basis');
      break;
    case 'TAX':
      params =
        f.appliesTo === 'WITHHOLDING'
          ? {
              appliesTo: 'WITHHOLDING',
              kind: f.kind,
              rateBps: pc(f.rate, 'Rate'),
              base: f.base,
              enabled: f.enabled,
            }
          : {
              appliesTo: f.appliesTo,
              mode: f.mode,
              components:
                f.mode === 'EXEMPT'
                  ? []
                  : f.components.map((c) => ({
                      code: c.code.trim().toUpperCase(),
                      rateBps: pc(c.rate, c.code || 'Component'),
                    })),
              liableParty: f.liableParty,
            };
      break;
    case 'DELIVERY':
      params = {
        strategy: f.strategy,
        ...(f.strategy === 'SLABS'
          ? {
              slabs: f.slabs.map((s, i) => ({
                upToM: km(s.upTo, `Slab ${i + 1} distance`),
                feePaise: rs(s.fee, `Slab ${i + 1} fee`),
              })),
            }
          : {}),
        ...(f.strategy === 'BASE_PLUS_PER_KM'
          ? {
              basePaise: rs(f.base, 'Base fee'),
              includedM: km(f.included, 'Included distance'),
              perKmPaise: rs(f.perKm, 'Per km'),
              billingUnitM: Number(f.unit),
            }
          : {}),
        ...(f.strategy === 'FLAT' ? { flatPaise: rs(f.flat, 'Flat fee') } : {}),
        minPaise: rs(f.min, 'Minimum fee', false),
        maxPaise: rs(f.max, 'Maximum fee', false),
        maxDistanceM: km(f.maxDistance, 'Maximum distance'),
        freeAboveSubtotalPaise: rs(f.freeAbove, 'Free above', false),
        ...(f.smallBelow || f.smallFee
          ? {
              smallOrder: {
                belowSubtotalPaise: rs(f.smallBelow, 'Small order below'),
                feePaise: rs(f.smallFee, 'Small order fee'),
              },
            }
          : {}),
      };
      break;
    case 'PLATFORM_FEE':
      params = {
        enabled: f.enabled,
        fixedPaise: rs(f.fixed, 'Fixed fee', false) ?? 0,
        rateBps: f.rate ? pc(f.rate, 'Percentage') : 0,
        minPaise: rs(f.min, 'Minimum', false),
        maxPaise: rs(f.max, 'Maximum', false),
      };
      break;
    case 'SURGE': {
      let value;
      if (f.type === 'FIXED') value = rs(f.value, 'Amount');
      else if (f.type === 'PERCENTAGE') value = pc(f.value, 'Percentage');
      else {
        const x = parsePercentToBps(f.value); // "1.25" → 125 → ×100 = 12 500 bps multiplier
        if (x == null) errors.push('Multiplier: use a value like 1.2');
        value = x == null ? undefined : x * 100;
      }
      params = {
        type: f.type,
        value,
        window: windowOf(f.start, f.end),
        applyWhenDeliveryFree: f.applyWhenDeliveryFree,
      };
      break;
    }
    case 'RIDER_EARNING':
      params = {
        basePaise: rs(f.base, 'Base pay'),
        includedM: km(f.included, 'Included distance'),
        perKmPaise: rs(f.perKm, 'Per km') ?? 0,
        billingUnitM: 100,
        minPaise: rs(f.min, 'Minimum', false) ?? 0,
        waitingFreeMin: Number(f.waitingFree || 0),
        waitingPerMinPaise: rs(f.waitingPerMin, 'Waiting per minute', false) ?? 0,
        incentives: f.incentives.map((i) => ({
          kind: i.kind,
          type: i.type,
          value: i.type === 'FIXED' ? rs(i.value, `${i.kind} incentive`) : pc(i.value, `${i.kind} incentive`),
          window: windowOf(i.start, i.end),
        })),
      };
      break;
    default:
      params = {};
  }
  return { params: JSON.parse(JSON.stringify(params)), errors };
}

function ParamsForm({ type, f, set }) {
  const upd = (k) => (v) => set({ ...f, [k]: v });
  switch (type) {
    case 'MARKUP':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice
            id="mk-type"
            label="Markup type"
            value={f.type}
            onChange={upd('type')}
            options={[
              ['PERCENTAGE', 'Percentage'],
              ['FIXED', 'Fixed amount'],
            ]}
          />
          {f.type === 'PERCENTAGE' ? (
            <Text id="mk-value" label="Markup" suffix="%" value={f.value} onChange={upd('value')} />
          ) : (
            <Money id="mk-value" label="Markup per item" value={f.value} onChange={upd('value')} />
          )}
          <Choice
            id="mk-round"
            label="Round the customer price"
            value={f.mode}
            onChange={upd('mode')}
            options={[
              ['NONE', 'No rounding'],
              ['NEAREST_1', 'To ₹1'],
              ['NEAREST_5', 'To ₹5'],
              ['NEAREST_10', 'To ₹10'],
              ['PSYCHOLOGICAL', 'To a price ending in…'],
            ]}
          />
          <Choice
            id="mk-dir"
            label="Rounding direction"
            value={f.direction}
            onChange={upd('direction')}
            options={[
              ['HALF_UP', 'Nearest'],
              ['UP', 'Up'],
              ['DOWN', 'Down (never below the restaurant price)'],
            ]}
          />
          {f.mode === 'PSYCHOLOGICAL' ? (
            <Text
              id="mk-digit"
              label="Ending digit"
              value={f.endingDigit}
              onChange={upd('endingDigit')}
              help="e.g. 9 → ₹119"
            />
          ) : null}
          <div className="flex items-center gap-2">
            <Switch id="mk-addons" checked={f.applyToAddons} onCheckedChange={upd('applyToAddons')} />
            <Label htmlFor="mk-addons">Also on add-ons (percentage only)</Label>
          </div>
        </div>
      );
    case 'COMMISSION':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice
            id="cm-type"
            label="Commission type"
            value={f.type}
            onChange={upd('type')}
            options={[
              ['PERCENTAGE', 'Percentage'],
              ['FIXED', 'Fixed per order'],
              ['HYBRID', 'Percentage and fixed'],
            ]}
          />
          <Choice
            id="cm-basis"
            label="Calculated on"
            value={f.basis}
            onChange={upd('basis')}
            options={[
              ['PRE_DISCOUNT', 'Food value before discounts'],
              ['POST_RESTAURANT_DISCOUNT', 'After restaurant-funded discounts'],
              ['POST_ALL_DISCOUNTS', 'After all discounts'],
            ]}
            help="Not assumed: choose explicitly (OD-10, Q-7)."
          />
          {f.type !== 'FIXED' ? (
            <Text id="cm-rate" label="Rate" suffix="%" value={f.rate} onChange={upd('rate')} />
          ) : null}
          {f.type !== 'PERCENTAGE' ? (
            <Money id="cm-fixed" label="Fixed amount" value={f.fixed} onChange={upd('fixed')} />
          ) : null}
          {f.type === 'HYBRID' ? (
            <Choice
              id="cm-hybrid"
              label="Combine"
              value={f.hybridMode}
              onChange={upd('hybridMode')}
              options={[
                ['SUM', 'Rate + fixed'],
                ['MAX', 'Whichever is higher'],
              ]}
            />
          ) : null}
        </div>
      );
    case 'TAX':
      return (
        <div className="grid gap-3">
          <Alert>
            <AlertDescription>
              Tax treatment is pending confirmation by your CA (Q-3). These values are configuration, not tax
              advice.
            </AlertDescription>
          </Alert>
          <Choice
            id="tx-applies"
            label="Applies to"
            value={f.appliesTo}
            onChange={upd('appliesTo')}
            options={[
              ...CHARGES.map((c) => [c, c.replace(/_/g, ' ').toLowerCase()]),
              ['WITHHOLDING', 'withholding on restaurant payouts (TCS/TDS)'],
            ]}
          />
          {f.appliesTo === 'WITHHOLDING' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice
                id="tx-kind"
                label="Kind"
                value={f.kind}
                onChange={upd('kind')}
                options={[
                  ['GST_TCS', 'GST TCS'],
                  ['INCOME_TAX_TDS', 'Income-tax TDS'],
                ]}
              />
              <Text id="tx-rate" label="Rate" suffix="%" value={f.rate} onChange={upd('rate')} />
              <Choice
                id="tx-base"
                label="On"
                value={f.base}
                onChange={upd('base')}
                options={[
                  ['FOOD_VALUE', 'Food value'],
                  ['FOOD_VALUE_AFTER_RESTAURANT_DISCOUNT', 'Food value after restaurant-funded discounts'],
                ]}
              />
              <div className="flex items-center gap-2">
                <Switch id="tx-enabled" checked={f.enabled} onCheckedChange={upd('enabled')} />
                <Label htmlFor="tx-enabled">Deduct from payouts</Label>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice
                id="tx-mode"
                label="Mode"
                value={f.mode}
                onChange={upd('mode')}
                options={[
                  ['EXCLUSIVE', 'Added on top'],
                  ['INCLUSIVE', 'Included in the price'],
                  ['EXEMPT', 'Exempt'],
                ]}
              />
              <Choice
                id="tx-liable"
                label="Liable party"
                value={f.liableParty}
                onChange={upd('liableParty')}
                options={[
                  ['PLATFORM', 'Jamzo'],
                  ['RESTAURANT', 'Restaurant'],
                ]}
              />
              {f.mode !== 'EXEMPT'
                ? f.components.map((c, i) => (
                    <div key={i} className="flex items-end gap-2 sm:col-span-2">
                      <Text
                        id={`tx-code-${i}`}
                        label="Component"
                        value={c.code}
                        onChange={(v) =>
                          set({
                            ...f,
                            components: f.components.map((x, j) => (j === i ? { ...x, code: v } : x)),
                          })
                        }
                      />
                      <Text
                        id={`tx-crate-${i}`}
                        label="Rate"
                        suffix="%"
                        value={c.rate}
                        onChange={(v) =>
                          set({
                            ...f,
                            components: f.components.map((x, j) => (j === i ? { ...x, rate: v } : x)),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${c.code}`}
                        onClick={() => set({ ...f, components: f.components.filter((_, j) => j !== i) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))
                : null}
              {f.mode !== 'EXEMPT' && f.components.length < 4 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => set({ ...f, components: [...f.components, { code: 'IGST', rate: '' }] })}
                >
                  <Plus /> Add component
                </Button>
              ) : null}
            </div>
          )}
        </div>
      );
    case 'DELIVERY':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice
            id="dl-strategy"
            label="How the fee is set"
            value={f.strategy}
            onChange={upd('strategy')}
            options={[
              ['SLABS', 'Distance slabs'],
              ['BASE_PLUS_PER_KM', 'Base fee + per km'],
              ['FLAT', 'Flat fee'],
            ]}
          />
          <Text
            id="dl-max"
            label="Maximum distance"
            suffix="km"
            value={f.maxDistance}
            onChange={upd('maxDistance')}
          />
          {f.strategy === 'SLABS' ? (
            <div className="grid gap-2 sm:col-span-2" role="group" aria-label="Distance slabs">
              {f.slabs.map((s, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Text
                    id={`dl-upto-${i}`}
                    label={`Up to (slab ${i + 1})`}
                    suffix="km"
                    value={s.upTo}
                    onChange={(v) =>
                      set({ ...f, slabs: f.slabs.map((x, j) => (j === i ? { ...x, upTo: v } : x)) })
                    }
                  />
                  <Money
                    id={`dl-fee-${i}`}
                    label="Fee"
                    value={s.fee}
                    onChange={(v) =>
                      set({ ...f, slabs: f.slabs.map((x, j) => (j === i ? { ...x, fee: v } : x)) })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove slab ${i + 1}`}
                    onClick={() => set({ ...f, slabs: f.slabs.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => set({ ...f, slabs: [...f.slabs, { upTo: '', fee: '' }] })}
              >
                <Plus /> Add slab
              </Button>
              <p className="text-xs text-muted-foreground">
                A distance exactly on a slab’s limit belongs to that slab (2.0 km → “up to 2 km”).
              </p>
            </div>
          ) : null}
          {f.strategy === 'BASE_PLUS_PER_KM' ? (
            <>
              <Money id="dl-base" label="Base fee" value={f.base} onChange={upd('base')} />
              <Text
                id="dl-included"
                label="Included in base"
                suffix="km"
                value={f.included}
                onChange={upd('included')}
              />
              <Money id="dl-perkm" label="Per extra km" value={f.perKm} onChange={upd('perKm')} />
              <Text id="dl-unit" label="Billed per" suffix="m" value={f.unit} onChange={upd('unit')} />
            </>
          ) : null}
          {f.strategy === 'FLAT' ? (
            <Money id="dl-flat" label="Flat fee" value={f.flat} onChange={upd('flat')} />
          ) : null}
          <Money id="dl-min" label="Minimum fee (optional)" value={f.min} onChange={upd('min')} />
          <Money id="dl-maxfee" label="Maximum fee (optional)" value={f.max} onChange={upd('max')} />
          <Money
            id="dl-free"
            label="Free delivery above (optional)"
            value={f.freeAbove}
            onChange={upd('freeAbove')}
            help="Food total after discounts."
          />
          <div />
          <Money
            id="dl-small-below"
            label="Small-order fee below (optional)"
            value={f.smallBelow}
            onChange={upd('smallBelow')}
          />
          <Money id="dl-small-fee" label="Small-order fee" value={f.smallFee} onChange={upd('smallFee')} />
        </div>
      );
    case 'PLATFORM_FEE':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch id="pf-enabled" checked={f.enabled} onCheckedChange={upd('enabled')} />
            <Label htmlFor="pf-enabled">
              Charge a platform fee here (switch off to remove it for this scope)
            </Label>
          </div>
          <Money id="pf-fixed" label="Fixed fee" value={f.fixed} onChange={upd('fixed')} />
          <Text
            id="pf-rate"
            label="Percentage of food total"
            suffix="%"
            value={f.rate}
            onChange={upd('rate')}
          />
          <Money id="pf-min" label="Minimum (optional)" value={f.min} onChange={upd('min')} />
          <Money id="pf-max" label="Maximum (optional)" value={f.max} onChange={upd('max')} />
        </div>
      );
    case 'SURGE':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice
            id="sg-type"
            label="Surcharge type"
            value={f.type}
            onChange={upd('type')}
            options={[
              ['FIXED', 'Fixed amount'],
              ['PERCENTAGE', 'Percentage of delivery fee'],
              ['MULTIPLIER', 'Delivery fee multiplier'],
            ]}
          />
          {f.type === 'FIXED' ? (
            <Money id="sg-value" label="Amount" value={f.value} onChange={upd('value')} />
          ) : (
            <Text
              id="sg-value"
              label={f.type === 'PERCENTAGE' ? 'Percentage' : 'Multiplier (e.g. 1.2)'}
              suffix={f.type === 'PERCENTAGE' ? '%' : '×'}
              value={f.value}
              onChange={upd('value')}
            />
          )}
          <Text
            id="sg-start"
            label="From (optional, HH:mm)"
            value={f.start}
            onChange={upd('start')}
            placeholder="23:00"
          />
          <Text
            id="sg-end"
            label="Until (optional, HH:mm)"
            value={f.end}
            onChange={upd('end')}
            placeholder="06:00"
          />
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch
              id="sg-free"
              checked={f.applyWhenDeliveryFree}
              onCheckedChange={upd('applyWhenDeliveryFree')}
            />
            <Label htmlFor="sg-free">Charge even when delivery is free</Label>
          </div>
        </div>
      );
    case 'RIDER_EARNING':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Money id="rd-base" label="Base pay" value={f.base} onChange={upd('base')} />
          <Text
            id="rd-included"
            label="Included distance"
            suffix="km"
            value={f.included}
            onChange={upd('included')}
          />
          <Money id="rd-perkm" label="Per extra km" value={f.perKm} onChange={upd('perKm')} />
          <Money id="rd-min" label="Minimum per order" value={f.min} onChange={upd('min')} />
          <Text
            id="rd-wfree"
            label="Free waiting"
            suffix="min"
            value={f.waitingFree}
            onChange={upd('waitingFree')}
          />
          <Money
            id="rd-wpay"
            label="Waiting pay per minute"
            value={f.waitingPerMin}
            onChange={upd('waitingPerMin')}
          />
          <div className="grid gap-2 sm:col-span-2" role="group" aria-label="Incentives">
            {f.incentives.map((i, n) => (
              <div key={n} className="flex flex-wrap items-end gap-2">
                <Choice
                  id={`rd-ik-${n}`}
                  label="Incentive"
                  value={i.kind}
                  onChange={(v) =>
                    set({ ...f, incentives: f.incentives.map((x, j) => (j === n ? { ...x, kind: v } : x)) })
                  }
                  options={[
                    ['NIGHT', 'Night'],
                    ['PEAK', 'Peak'],
                    ['RAIN', 'Rain'],
                    ['MANUAL', 'Manual'],
                  ]}
                />
                <Text
                  id={`rd-iv-${n}`}
                  label={i.type === 'FIXED' ? 'Amount (₹)' : 'Percentage'}
                  value={i.value}
                  onChange={(v) =>
                    set({ ...f, incentives: f.incentives.map((x, j) => (j === n ? { ...x, value: v } : x)) })
                  }
                />
                <Text
                  id={`rd-is-${n}`}
                  label="From"
                  value={i.start}
                  onChange={(v) =>
                    set({ ...f, incentives: f.incentives.map((x, j) => (j === n ? { ...x, start: v } : x)) })
                  }
                  placeholder="23:00"
                />
                <Text
                  id={`rd-ie-${n}`}
                  label="Until"
                  value={i.end}
                  onChange={(v) =>
                    set({ ...f, incentives: f.incentives.map((x, j) => (j === n ? { ...x, end: v } : x)) })
                  }
                  placeholder="06:00"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove incentive ${n + 1}`}
                  onClick={() => set({ ...f, incentives: f.incentives.filter((_, j) => j !== n) })}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() =>
                set({
                  ...f,
                  incentives: [
                    ...f.incentives,
                    { kind: 'NIGHT', type: 'FIXED', value: '', start: '23:00', end: '06:00' },
                  ],
                })
              }
            >
              <Plus /> Add incentive
            </Button>
          </div>
        </div>
      );
    default:
      return null;
  }
}

/**
 * Creates a new version of a rule (D-50). `basedOn` = the version being replaced (stale edits are refused
 * by the API), or null for a rule that does not exist yet at that target.
 */
export function RuleDialog({ type, basedOn, defaults, onClose }) {
  const [scope, setScope] = useState(basedOn?.scope ?? defaults?.scope ?? 'GLOBAL');
  const [scopeRefId, setRef] = useState(basedOn?.scopeRefId ?? defaults?.scopeRefId ?? null);
  const [kind, setKind] = useState(basedOn?.kind ?? 'NIGHT');
  const [f, setF] = useState(() => initialForm(type, basedOn?.params));
  const [note, setNote] = useState('');
  const [start, setStart] = useState('');
  const [local, setLocal] = useState([]);
  const m = useApiMutation({
    mutationFn: (body) => api.post('/v1/admin/pricing/rules', body),
    invalidate: [['pricing'], ['menu'], ['restaurant']],
    success: 'New rule version saved',
    onSuccess: onClose,
  });
  const serverErrors = Object.entries(m.fieldErrors).map(
    ([k, v]) => `${k.replace(/^params\./, '')}: ${v.join(' ')}`,
  );
  const submit = () => {
    const { params, errors } = toParams(type, f);
    if (scope !== 'GLOBAL' && !scopeRefId) errors.push('Choose what the rule applies to');
    if (note.trim().length < 3) errors.push('Say why this changes (recorded in the history)');
    setLocal(errors);
    if (errors.length) return;
    m.mutate({
      type,
      scope,
      scopeRefId: scope === 'GLOBAL' ? null : scopeRefId,
      ...(type === 'SURGE' ? { kind } : {}),
      params,
      changeNote: note.trim(),
      ...(start ? { effectiveFrom: new Date(start).toISOString() } : {}),
      basedOnId: basedOn?.id ?? null,
    });
  };
  const locked = Boolean(basedOn);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {basedOn
              ? `New version: ${ruleTypeLabel(type)}`
              : `New ${ruleTypeLabel(type).toLowerCase()} rule`}
          </DialogTitle>
          <DialogDescription>
            Rules are never edited in place: saving creates a new version and closes the current one at the
            start time. Orders keep the version they were priced with.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice
              id="r-scope"
              label="Applies to"
              value={scope}
              onChange={(v) => (setScope(v), setRef(null))}
              options={scopesFor(type, f.appliesTo).map((s) => [s.value, s.label])}
            />
            {type === 'SURGE' ? (
              <Choice
                id="r-kind"
                label="Surcharge kind"
                value={kind}
                onChange={setKind}
                options={[
                  ['NIGHT', 'Night'],
                  ['DEMAND', 'Demand'],
                  ['WEATHER', 'Weather'],
                  ['MANUAL', 'Manual'],
                ]}
              />
            ) : null}
            <div className="sm:col-span-2">
              {locked ? (
                <p className="text-sm">Target: {basedOn.targetName ?? scope}</p>
              ) : (
                <TargetPicker id="r-target" scope={scope} value={scopeRefId} onChange={setRef} />
              )}
            </div>
          </div>
          <ParamsForm type={type} f={f} set={setF} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              id="r-start"
              label="Starts (optional)"
              help="Empty = now. Rules cannot start in the past."
            >
              {(a) => (
                <Input
                  {...a}
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              )}
            </FormField>
            <FormField id="r-note" label="Why (required)">
              {(a) => <Textarea {...a} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
            </FormField>
          </div>
          {[...local, ...serverErrors].length ? (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {[...local, ...serverErrors].map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={m.isPending}>
            {m.isPending ? 'Saving…' : 'Save new version'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
