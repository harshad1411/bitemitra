// Commercial rule administration (PRICING.md §2–§3, §9; DECISIONS D-50 … D-54). Every change is a new
// version; nothing is edited in place except the surge kill-switch, and every write is audit-logged.
import { z } from 'zod';
import {
  cartQuoteBody,
  couponBody,
  pricingPreviewBody,
  pricingRuleCreateBody,
  pricingRuleEndBody,
  pricingRuleListQuery,
  pricingRuleType,
  promotionBody,
  surgeSwitchBody,
  uuid,
} from '@jamzo/validation';
import { resolveScoped } from '@jamzo/config';
import { applyBps, applyMarkup, parseRuleParams, RULE_TYPES, TAXABLE_CHARGES } from '@jamzo/pricing-engine';
import { isUniqueViolation } from '@jamzo/database';
import { AppError, conflict, forbidden, invalid, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { canInCity, hasGlobal } from '../../core/auth.js';
import { withIdempotency } from '../../core/idempotency.js';
import { quoteCart } from '../customer/cart.js';
import { loadRuleSet, RULE_SOURCES, ruleTargets } from './service.js';

const LINE_SCOPES = new Set(['CATEGORY', 'PRODUCT', 'VARIANT']);
const OPEN_KEY = (row) =>
  JSON.stringify([
    row.scope,
    row.scopeRefId ?? null,
    row.restaurantId ?? null,
    row.priority ?? 0,
    row.kind ?? null,
    row.params?.appliesTo ?? null,
    row.params?.kind ?? null,
  ]);

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function pricingRoutes(app) {
  const prisma = app.prisma;

  /** City a rule target belongs to (null = platform-wide target, which needs a global permission). */
  async function targetCity(scope, scopeRefId) {
    const find = async (model, where, include) => {
      const row = await prisma[model].findUnique({ where, ...(include ? { include } : {}) });
      if (!row) throw notFound(`${scope.toLowerCase()} target`);
      return row;
    };
    switch (scope) {
      case 'GLOBAL':
        return null;
      case 'COUNTRY':
        await find('country', { id: scopeRefId });
        return null;
      case 'STATE':
        await find('state', { id: scopeRefId });
        return null;
      case 'CATEGORY':
        await find('category', { id: scopeRefId });
        return null;
      case 'CITY':
        return (await find('city', { id: scopeRefId })).id;
      case 'ZONE':
        return (await find('zone', { id: scopeRefId })).cityId;
      case 'RESTAURANT':
        return (await find('restaurant', { id: scopeRefId })).cityId;
      case 'BRANCH':
        return (await find('restaurantBranch', { id: scopeRefId }, { restaurant: true })).restaurant.cityId;
      case 'PRODUCT':
        return (await find('product', { id: scopeRefId }, { restaurant: true })).restaurant.cityId;
      case 'VARIANT':
        return (
          await find('productVariant', { id: scopeRefId }, { product: { include: { restaurant: true } } })
        ).product.restaurant.cityId;
      default:
        throw invalid('Unknown scope.', { scope: ['Unknown'] });
    }
  }

  async function assertRulePermission(request, type, scope, scopeRefId) {
    const permission = RULE_TYPES[type].permission;
    const cityId = await targetCity(scope, scopeRefId);
    const ok = cityId ? canInCity(request, permission, cityId) : hasGlobal(request, permission);
    if (!ok)
      throw forbidden(
        `Changing ${type.toLowerCase().replace('_', ' ')} rules here needs the ${permission} permission${cityId ? ' for this city' : ' for all cities'}.`,
      );
  }

  const ruleDto = (type, r) => ({
    type,
    id: r.id,
    scope: r.scope,
    scopeRefId: r.scopeRefId,
    restaurantId: r.restaurantId,
    kind: r.kind ?? null,
    isEnabled: r.isEnabled ?? null,
    priority: r.priority,
    params: r.params,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    supersedesId: r.supersedesId,
    changeNote: r.changeNote,
    createdById: r.createdById,
    createdAt: r.createdAt,
    pendingCaReview: type === 'TAX', // D-51
  });

  /** Names for rule targets, fetched in bulk for display. */
  async function targetNames(rows) {
    const ids = (scope) => [...new Set(rows.filter((r) => r.scope === scope).map((r) => r.scopeRefId))];
    const [cities, zones, restaurants, branches, categories, products, variants, qualifiers] =
      await Promise.all([
        prisma.city.findMany({ where: { id: { in: ids('CITY') } } }),
        prisma.zone.findMany({ where: { id: { in: ids('ZONE') } }, include: { city: true } }),
        prisma.restaurant.findMany({ where: { id: { in: ids('RESTAURANT') } } }),
        prisma.restaurantBranch.findMany({ where: { id: { in: ids('BRANCH') } } }),
        prisma.category.findMany({ where: { id: { in: ids('CATEGORY') } } }),
        prisma.product.findMany({ where: { id: { in: ids('PRODUCT') } }, include: { restaurant: true } }),
        prisma.productVariant.findMany({ where: { id: { in: ids('VARIANT') } }, include: { product: true } }),
        prisma.restaurant.findMany({
          where: { id: { in: rows.map((r) => r.restaurantId).filter(Boolean) } },
        }),
      ]);
    const m = new Map([
      ...cities.map((c) => [c.id, c.name]),
      ...zones.map((z) => [z.id, `${z.name} (${z.city.name})`]),
      ...restaurants.map((r) => [r.id, r.name]),
      ...branches.map((b) => [b.id, b.name]),
      ...categories.map((c) => [c.id, c.name]),
      ...products.map((p) => [p.id, `${p.name} · ${p.restaurant.name}`]),
      ...variants.map((v) => [v.id, `${v.product.name} (${v.name})`]),
      ...qualifiers.map((r) => [r.id, r.name]),
    ]);
    return (row) => ({
      targetName: row.scope === 'GLOBAL' ? 'All cities' : (m.get(row.scopeRefId) ?? row.scopeRefId),
      qualifierName: row.restaurantId ? m.get(row.restaurantId) : null,
    });
  }

  // ── Rules ──
  app.get(
    '/v1/admin/pricing/rules',
    { config: { permission: 'pricing.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const q = parse(pricingRuleListQuery, request.query);
      const now = app.clock.now();
      const rows = await prisma[RULE_SOURCES[q.type].table].findMany({
        where: {
          ...(q.scope ? { scope: q.scope } : {}),
          ...(q.scopeRefId ? { scopeRefId: q.scopeRefId } : {}),
          ...(q.include === 'CURRENT' ? { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] } : {}),
        },
        orderBy: [{ scope: 'asc' }, { effectiveFrom: 'desc' }],
        take: 500,
      });
      const names = await targetNames(rows);
      return {
        type: q.type,
        items: rows.map((r) => ({
          ...ruleDto(q.type, r),
          ...names(r),
          status:
            r.effectiveFrom > now ? 'SCHEDULED' : r.effectiveTo && r.effectiveTo <= now ? 'ENDED' : 'ACTIVE',
        })),
      };
    },
  );

  app.post(
    '/v1/admin/pricing/rules',
    { config: { permission: 'pricing.view' } }, // the rule type's own permission is checked below (D-50)
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
      const body = parse(pricingRuleCreateBody, request.body);
      const def = RULE_TYPES[body.type];
      const parsed = def.schema.safeParse(body.params);
      if (!parsed.success) {
        const fieldErrors = {};
        for (const i of parsed.error.issues)
          (fieldErrors[['params', ...i.path].join('.')] ??= []).push(i.message);
        throw invalid('The rule settings are invalid.', fieldErrors);
      }
      const params = parsed.data;
      if (body.scope === 'GLOBAL' ? body.scopeRefId : !body.scopeRefId)
        throw invalid('Choose what this rule applies to.', {
          scopeRefId: [body.scope === 'GLOBAL' ? 'Must be empty for global rules' : 'Required'],
        });
      if (LINE_SCOPES.has(body.scope)) {
        const allowed =
          body.type === 'MARKUP' ||
          (body.scope !== 'VARIANT' &&
            (body.type === 'COMMISSION' || (body.type === 'TAX' && params.appliesTo === 'FOOD')));
        if (!allowed)
          throw invalid(`${body.type} rules cannot be set per ${body.scope.toLowerCase()}.`, {
            scope: ['Not allowed for this rule type'],
          });
      }
      if (body.restaurantId && body.scope !== 'CATEGORY')
        throw invalid('A restaurant qualifier only applies to category rules.', {
          restaurantId: ['Only for CATEGORY'],
        });
      if (body.type === 'SURGE' && !body.kind)
        throw invalid('Choose the surcharge kind.', { kind: ['Required'] });
      if (body.type !== 'SURGE' && (body.kind || body.isEnabled !== undefined))
        throw invalid('Kind and switch only apply to surcharges.', { kind: ['Only for SURGE'] });
      await assertRulePermission(request, body.type, body.scope, body.scopeRefId ?? null);
      if (body.restaurantId) await targetCity('RESTAURANT', body.restaurantId);
      const now = app.clock.now();
      const from = body.effectiveFrom ? new Date(body.effectiveFrom) : now;
      if (from.getTime() < now.getTime() - 60_000)
        throw invalid('Rules cannot start in the past: old quotes must stay reproducible.', {
          effectiveFrom: ['In the past'],
        });
      const table = RULE_SOURCES[body.type].table;
      const candidate = {
        scope: body.scope,
        scopeRefId: body.scopeRefId ?? null,
        restaurantId: body.restaurantId ?? null,
        priority: body.priority,
        kind: body.kind ?? null,
        params,
      };

      return withIdempotency(request, reply, { successStatus: 201 }, async () => {
        try {
          return await prisma.$transaction(async (tx) => {
            const open = (
              await tx[table].findMany({
                where: {
                  scope: candidate.scope,
                  scopeRefId: candidate.scopeRefId,
                  restaurantId: candidate.restaurantId,
                  priority: candidate.priority,
                  effectiveTo: null,
                },
              })
            ).find((r) => OPEN_KEY(r) === OPEN_KEY(candidate));
            // Stale-edit guard: another admin changed this rule after the form was opened.
            if (body.basedOnId !== undefined && (open?.id ?? null) !== body.basedOnId)
              throw conflict(
                'Someone else changed this rule after you opened it. Reload to see the current version.',
              );
            if (open && open.effectiveFrom >= from)
              throw conflict(
                'A newer version of this rule is already scheduled. End it first or choose a later start.',
              );
            if (open) await tx[table].update({ where: { id: open.id }, data: { effectiveTo: from } });
            const created = await tx[table].create({
              data: {
                scope: candidate.scope,
                scopeRefId: candidate.scopeRefId,
                restaurantId: candidate.restaurantId,
                priority: candidate.priority,
                params,
                effectiveFrom: from,
                supersedesId: open?.id ?? null,
                createdById: request.auth.userId,
                changeNote: body.changeNote,
                ...(body.type === 'SURGE'
                  ? { kind: body.kind, isEnabled: body.isEnabled ?? open?.isEnabled ?? true }
                  : {}),
              },
            });
            await audit(tx, request, {
              action: 'pricing_rule.version',
              entityType: `pricing_rule:${body.type}`,
              entityId: created.id,
              oldValue: open ? { id: open.id, params: open.params } : null,
              newValue: {
                scope: created.scope,
                scopeRefId: created.scopeRefId,
                params,
                effectiveFrom: created.effectiveFrom,
                changeNote: body.changeNote,
              },
            });
            return ruleDto(body.type, created);
          });
        } catch (err) {
          if (isUniqueViolation(err))
            throw conflict('Another version of this rule was saved at the same time. Reload and try again.');
          throw err;
        }
      });
    },
  );

  const typeParams = z.object({ type: pricingRuleType, id: uuid });

  app.post(
    '/v1/admin/pricing/rules/:type/:id/end',
    { config: { permission: 'pricing.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { type, id } = parse(typeParams, request.params);
      const body = parse(pricingRuleEndBody, request.body);
      const table = RULE_SOURCES[type].table;
      const rule = await prisma[table].findUnique({ where: { id } });
      if (!rule) throw notFound('Rule');
      await assertRulePermission(request, type, rule.scope, rule.scopeRefId);
      const now = app.clock.now();
      const at = body.at ? new Date(body.at) : now;
      if (at.getTime() < now.getTime() - 60_000)
        throw invalid('A rule cannot end in the past.', { at: ['In the past'] });
      if (rule.effectiveTo && rule.effectiveTo <= at) throw conflict('This rule has already ended.');
      if (at <= rule.effectiveFrom)
        throw invalid('A rule must end after it starts.', { at: ['Before the start'] });
      return prisma.$transaction(async (tx) => {
        const updated = await tx[table].update({ where: { id }, data: { effectiveTo: at } });
        await audit(tx, request, {
          action: 'pricing_rule.end',
          entityType: `pricing_rule:${type}`,
          entityId: id,
          oldValue: { effectiveTo: rule.effectiveTo },
          newValue: { effectiveTo: at, changeNote: body.changeNote },
        });
        return ruleDto(type, updated);
      });
    },
  );

  app.get(
    '/v1/admin/pricing/rules/:type/:id/history',
    { config: { permission: 'pricing.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { type, id } = parse(typeParams, request.params);
      const table = RULE_SOURCES[type].table;
      const start = await prisma[table].findUnique({ where: { id } });
      if (!start) throw notFound('Rule');
      const chain = [start];
      for (let r = start; r.supersedesId && chain.length < 200;) {
        r = await prisma[table].findUnique({ where: { id: r.supersedesId } });
        if (!r) break;
        chain.push(r);
      }
      for (let r = start; chain.length < 400;) {
        const next = await prisma[table].findUnique({ where: { supersedesId: r.id } });
        if (!next) break;
        chain.unshift(next);
        r = next;
      }
      return { type, items: chain.map((r) => ruleDto(type, r)) };
    },
  );

  // Surcharge kill-switch: the only in-place change (spec §15 "enable/disable instantly"), audit-logged.
  app.patch(
    '/v1/admin/pricing/surge/:id/switch',
    { config: { permission: 'pricing.surge' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { id } = parse(z.object({ id: uuid }), request.params);
      const body = parse(surgeSwitchBody, request.body);
      const rule = await prisma.surgeRule.findUnique({ where: { id } });
      if (!rule) throw notFound('Surcharge rule');
      await assertRulePermission(request, 'SURGE', rule.scope, rule.scopeRefId);
      return prisma.$transaction(async (tx) => {
        const updated = await tx.surgeRule.update({ where: { id }, data: { isEnabled: body.isEnabled } });
        await audit(tx, request, {
          action: body.isEnabled ? 'surge.enable' : 'surge.disable',
          entityType: 'pricing_rule:SURGE',
          entityId: id,
          oldValue: { isEnabled: rule.isEnabled },
          newValue: { isEnabled: body.isEnabled, changeNote: body.changeNote },
        });
        return ruleDto('SURGE', updated);
      });
    },
  );

  /** Restaurant context for "which rule wins here" and previews. */
  async function restaurantContext(restaurantId) {
    const r = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        city: { include: { state: true } },
        branches: { orderBy: [{ isPrimary: 'desc' }], take: 1 },
      },
    });
    if (!r) throw notFound('Restaurant');
    const branch = r.branches[0] ?? null;
    return {
      restaurant: r,
      ctx: {
        countryId: r.city.state.countryId,
        stateId: r.city.stateId,
        cityId: r.cityId,
        zoneId: branch?.zoneId ?? undefined,
        restaurantId: r.id,
        branchId: branch?.id,
      },
    };
  }

  app.get(
    '/v1/admin/pricing/effective',
    { config: { permission: 'pricing.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const { restaurantId } = parse(z.object({ restaurantId: uuid }), request.query);
      const { restaurant, ctx } = await restaurantContext(restaurantId);
      if (!canInCity(request, 'pricing.view', restaurant.cityId)) throw forbidden();
      const now = app.clock.now();
      const rules = await loadRuleSet(prisma, ruleTargets({ ...ctx, zoneIds: [ctx.zoneId] }), now);
      const win = (type, list, filter = () => true) => {
        const hit = resolveScoped(list.filter(filter), ctx, now);
        return hit ? { ...ruleDto(type, hit.winner), inheritedFrom: hit.inheritedFrom } : null;
      };
      return {
        restaurant: { id: restaurant.id, name: restaurant.name },
        note: 'Restaurant-level view: product, category and delivery-zone rules can still win for individual items or addresses.',
        markup: win('MARKUP', rules.markup),
        commission: win('COMMISSION', rules.commission),
        platformFee: win('PLATFORM_FEE', rules.platformFee),
        delivery: win('DELIVERY', rules.delivery),
        riderEarning: win('RIDER_EARNING', rules.riderEarning),
        surge: Object.fromEntries(
          ['NIGHT', 'DEMAND', 'WEATHER', 'MANUAL'].map((k) => [
            k,
            win('SURGE', rules.surge, (r) => r.kind === k),
          ]),
        ),
        tax: Object.fromEntries(
          TAXABLE_CHARGES.map((c) => [c, win('TAX', rules.tax, (r) => r.params?.appliesTo === c)]),
        ),
      };
    },
  );

  // Price preview for a restaurant's menu with the current rules and, optionally, a draft rule (§9).
  app.post(
    '/v1/admin/pricing/preview',
    { config: { permission: 'pricing.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const body = parse(pricingPreviewBody, request.body);
      const { restaurant, ctx } = await restaurantContext(body.restaurantId);
      if (!canInCity(request, 'pricing.view', restaurant.cityId)) throw forbidden();
      const now = app.clock.now();
      if (body.draft) {
        const r = RULE_TYPES[body.draft.type].schema.safeParse(body.draft.params);
        if (!r.success)
          throw invalid(
            'The draft rule is invalid.',
            Object.fromEntries(
              r.error.issues.map((i) => [['draft', 'params', ...i.path].join('.'), [i.message]]),
            ),
          );
      }
      const products = await prisma.product.findMany({
        where: { restaurantId: restaurant.id, status: 'ACTIVE' },
        include: { variants: { where: { isDefault: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: 200,
      });
      const rules = await loadRuleSet(
        prisma,
        ruleTargets({
          ...ctx,
          zoneIds: [ctx.zoneId],
          categoryIds: products.map((p) => p.categoryId).filter(Boolean),
          productIds: products.map((p) => p.id),
        }),
        now,
        ['MARKUP', 'COMMISSION'],
      );
      const draftRow = body.draft
        ? {
            id: 'draft',
            scope: body.draft.scope,
            scopeRefId: body.draft.scopeRefId ?? null,
            restaurantId: body.draft.restaurantId ?? null,
            params: body.draft.params,
            priority: 1_000_000,
            effectiveFrom: now,
            effectiveTo: null,
          }
        : null;
      const priceWith = (list, type, lineCtx) => {
        const hit = resolveScoped(list, lineCtx, now);
        return hit
          ? { rule: hit.winner, params: /** @type {any} */ (parseRuleParams(type, hit.winner)) }
          : null;
      };
      const commissionOn = (base, p) => {
        if (!p) return 0;
        const rate = p.rateBps !== undefined ? applyBps(base, p.rateBps) : 0;
        return p.type === 'PERCENTAGE'
          ? rate
          : p.type === 'FIXED'
            ? p.fixedPaise
            : p.hybridMode === 'MAX'
              ? Math.max(rate, p.fixedPaise)
              : rate + p.fixedPaise;
      };
      const items = products.map((p) => {
        const base = p.variants[0]?.basePricePaise ?? p.basePricePaise;
        const lineCtx = { ...ctx, productId: p.id, categoryId: p.categoryId ?? undefined };
        const current = {
          markup: priceWith(rules.markup, 'MARKUP', lineCtx),
          commission: priceWith(rules.commission, 'COMMISSION', lineCtx),
        };
        const draft = {
          markup:
            body.draft?.type === 'MARKUP'
              ? priceWith([...rules.markup, draftRow], 'MARKUP', lineCtx)
              : current.markup,
          commission:
            body.draft?.type === 'COMMISSION'
              ? priceWith([...rules.commission, draftRow], 'COMMISSION', lineCtx)
              : current.commission,
        };
        const view = (s) => {
          const customerPrice = applyMarkup(base, s.markup?.params ?? null);
          const commission = commissionOn(base, s.commission?.params ?? null);
          return {
            customerPricePaise: customerPrice,
            markupPaise: customerPrice - base,
            commissionPaise: commission,
            restaurantNetPaise: base - commission, // before commission tax, packaging and discounts
            platformPaise: customerPrice - base + commission,
            markupRuleId: s.markup?.rule.id ?? null,
            commissionRuleId: s.commission?.rule.id ?? null,
          };
        };
        return {
          productId: p.id,
          name: p.name,
          restaurantPricePaise: base,
          current: view(current),
          draft: body.draft ? view(draft) : null,
        };
      });
      return {
        restaurant: { id: restaurant.id, name: restaurant.name },
        note: 'Per item, before discounts, packaging and taxes (commission tax excluded). Use the test quote for a full bill.',
        items,
      };
    },
  );

  // Full test quote with the restaurant, rider and platform breakdown (never shown to customers).
  app.post(
    '/v1/admin/pricing/quote',
    { config: { permission: 'pricing.view' } },
    async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
      const body = parse(cartQuoteBody, request.body);
      if (body.addressId)
        throw invalid('Use a location (lat/lng) for admin test quotes.', {
          addressId: ['Not supported here'],
        });
      const r = await prisma.restaurant.findUnique({ where: { id: body.restaurantId } });
      if (!r) throw notFound('Restaurant');
      if (!canInCity(request, 'pricing.view', r.cityId)) throw forbidden();
      return quoteCart(app, request, body, { audience: 'ADMIN' });
    },
  );

  // ── Coupons & promotions (promotions.manage) ──
  const offerData = (b) => ({
    discountType: b.discountType,
    valueBps: b.discountType === 'PERCENTAGE' ? b.valueBps : null,
    valuePaise: b.discountType === 'FIXED' ? b.valuePaise : null,
    maxDiscountPaise: b.maxDiscountPaise ?? null,
    minOrderPaise: b.minOrderPaise ?? null,
    fundingSource: b.fundingSource,
    restaurantShareBps: b.fundingSource === 'SHARED' ? b.restaurantShareBps : null,
    targeting: b.targeting,
    startsAt: new Date(b.startsAt),
    endsAt: b.endsAt ? new Date(b.endsAt) : null,
    isActive: b.isActive,
  });

  for (const kind of /** @type {const} */ (['coupons', 'promotions'])) {
    const model = kind === 'coupons' ? 'coupon' : 'promotion';
    const schema = kind === 'coupons' ? couponBody : promotionBody;
    const extra = (b) =>
      kind === 'coupons'
        ? {
            code: b.code,
            description: b.description ?? null,
            firstOrderOnly: b.firstOrderOnly,
            usageLimit: b.usageLimit ?? null,
            perUserLimit: b.perUserLimit ?? null,
          }
        : { name: b.name, priority: b.priority };

    app.get(
      `/v1/admin/${kind}`,
      { config: { permission: 'promotions.manage' } },
      async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
        const q = parse(
          z.object({ status: z.enum(['ACTIVE', 'SCHEDULED', 'ENDED', 'ALL']).default('ALL') }),
          request.query,
        );
        const now = app.clock.now();
        const rows = await prisma[model].findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
        const status = (o) =>
          !o.isActive
            ? 'PAUSED'
            : o.startsAt > now
              ? 'SCHEDULED'
              : o.endsAt && o.endsAt <= now
                ? 'ENDED'
                : 'ACTIVE';
        return {
          items: rows
            .map((o) => ({ ...o, status: status(o) }))
            .filter((o) => q.status === 'ALL' || o.status === q.status),
        };
      },
    );

    app.post(
      `/v1/admin/${kind}`,
      { config: { permission: 'promotions.manage' } },
      async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
        const b = parse(schema, request.body);
        return withIdempotency(request, reply, { successStatus: 201 }, () =>
          prisma.$transaction(async (tx) => {
            let row;
            try {
              row = await tx[model].create({
                data: {
                  ...offerData(b),
                  ...extra(b),
                  ...(kind === 'coupons' ? { createdById: request.auth.userId } : {}),
                },
              });
            } catch (err) {
              if (isUniqueViolation(err)) throw conflict('A coupon with this code already exists.');
              throw err;
            }
            await audit(tx, request, {
              action: `${model}.create`,
              entityType: model,
              entityId: row.id,
              newValue: row,
            });
            return row;
          }),
        );
      },
    );

    app.patch(
      `/v1/admin/${kind}/:id`,
      { config: { permission: 'promotions.manage' } },
      async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
        const { id } = parse(z.object({ id: uuid }), request.params);
        const b = parse(schema, request.body); // full replacement; coupon codes never change
        return prisma.$transaction(async (tx) => {
          const before = await tx[model].findUnique({ where: { id } });
          if (!before) throw notFound(model === 'coupon' ? 'Coupon' : 'Promotion');
          if (kind === 'coupons' && b.code !== before.code)
            throw new AppError('VALIDATION_FAILED', 'A coupon code cannot be changed. Create a new coupon.', {
              fieldErrors: { code: ['Cannot change'] },
            });
          const { code: _c, ...rest } = /** @type {any} */ (extra(b));
          const after = await tx[model].update({ where: { id }, data: { ...offerData(b), ...rest } });
          await audit(tx, request, {
            action: `${model}.update`,
            entityType: model,
            entityId: id,
            oldValue: before,
            newValue: after,
          });
          return after;
        });
      },
    );
  }
}
