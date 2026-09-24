// Configuration module (CONFIGURATION.md): hierarchical settings with history, feature flags, app version
// policies and the remote config served to apps. Reads use a short in-process cache (no Redis — D-9).
import { SETTINGS, evaluateFlag, getSettingDefinition, resolveScoped, scopeTargets, validateSetting, versionStatus } from '@jamzo/config';
import { AppError, notFound } from '../../core/errors.js';
import { audit } from '../../core/audit.js';

export const CURRENT_PHASE = 1;
const PHASE_TARGETS_UNAVAILABLE = new Set(['BRANCH', 'CATEGORY', 'PRODUCT', 'VARIANT']);

/**
 * @param {import('@jamzo/database').Db} prisma
 * @param {{ now: () => Date }} clock
 * @param {{ ttlMs?: number }} [opts]
 */
export function createConfigService(prisma, clock, { ttlMs = 30_000 } = {}) {
  /** @type {Map<string, { at: number, value: any }>} */
  const cache = new Map();
  const cached = async (key, load) => {
    const hit = cache.get(key);
    const t = clock.now().getTime();
    if (hit && t - hit.at < ttlMs) return hit.value;
    const value = await load();
    cache.set(key, { at: t, value });
    return value;
  };
  const invalidate = () => cache.clear();

  /**
   * Geography context for a scope target, e.g. CITY → { countryId, stateId, cityId }.
   * @param {string} scope
   * @param {string | null | undefined} scopeRefId
   */
  async function contextFor(scope, scopeRefId) {
    if (scope === 'GLOBAL') return {};
    if (PHASE_TARGETS_UNAVAILABLE.has(scope)) {
      throw new AppError('VALIDATION_FAILED', `${scope} overrides become available when that entity exists (Phase 2+).`, {
        fieldErrors: { scope: ['Not available yet'] },
      });
    }
    if (!scopeRefId) throw new AppError('VALIDATION_FAILED', 'scopeRefId is required for non-global scopes.', { fieldErrors: { scopeRefId: ['Required'] } });
    if (scope === 'COUNTRY') {
      const c = await prisma.country.findUnique({ where: { id: scopeRefId } });
      if (!c) throw notFound('Country');
      return { countryId: c.id };
    }
    if (scope === 'STATE') {
      const s = await prisma.state.findUnique({ where: { id: scopeRefId } });
      if (!s) throw notFound('State');
      return { countryId: s.countryId, stateId: s.id };
    }
    if (scope === 'CITY' || scope === 'ZONE' || scope === 'RESTAURANT') {
      let cityId = scopeRefId;
      const extra = {};
      if (scope === 'ZONE') {
        const z = await prisma.zone.findUnique({ where: { id: scopeRefId } });
        if (!z) throw notFound('Zone');
        cityId = z.cityId;
        extra.zoneId = z.id;
      }
      if (scope === 'RESTAURANT') {
        const r = await prisma.restaurant.findUnique({ where: { id: scopeRefId } });
        if (!r) throw notFound('Restaurant');
        cityId = r.cityId;
        extra.restaurantId = r.id;
      }
      const city = await prisma.city.findUnique({ where: { id: cityId }, include: { state: true } });
      if (!city) throw notFound('City');
      return { countryId: city.state.countryId, stateId: city.stateId, cityId: city.id, ...extra };
    }
    throw new AppError('VALIDATION_FAILED', `Unsupported scope ${scope}`);
  }

  /** Setting rows for a key relevant to a context. */
  async function candidates(key, ctx) {
    const targets = scopeTargets(ctx);
    return prisma.setting.findMany({
      where: { key, OR: targets.map((t) => ({ scope: t.scope, scopeRefId: t.scopeRefId })) },
    });
  }

  /**
   * Effective value for a context (most specific override wins; else the registry default).
   * @param {string} key
   * @param {Record<string, string>} [ctx]
   */
  async function resolve(key, ctx = {}) {
    const def = getSettingDefinition(key);
    if (!def) throw new Error(`Unknown setting ${key}`);
    return cached(`setting:${key}:${JSON.stringify(ctx)}`, async () => {
      const winner = resolveScoped(await candidates(key, ctx), ctx);
      if (!winner) return { value: def.default, source: null };
      // Stored values are re-validated on read; an invalid stored value falls back to the default loudly.
      const parsed = def.schema.safeParse(/** @type {any} */ (winner.winner).value);
      if (!parsed.success) return { value: def.default, source: null, invalidStoredValue: true };
      return { value: parsed.data, source: { scope: winner.winner.scope, scopeRefId: winner.winner.scopeRefId } };
    });
  }

  /** Extra business rules on top of the schema. */
  function extraValidation(key, value) {
    if (key === 'auth.methods') {
      for (const [app, methods] of Object.entries(value)) {
        const bad = methods.filter((m) => m === 'GOOGLE' || m === 'APPLE');
        if (bad.length) {
          return `${bad.join(' and ')} sign-in is not implemented yet (needs OAuth client ids — DECISIONS Q-6b).`;
        }
        if (app === 'ADMIN' && (methods.length !== 1 || methods[0] !== 'PASSWORD')) return 'Admin sign-in must be PASSWORD in Phase 1.';
        if (app !== 'ADMIN' && methods.includes('PASSWORD')) return 'Password sign-in is only available for Admin in Phase 1.';
      }
    }
    return null;
  }

  /**
   * Admin view of every setting at a scope target: effective value, where it comes from, and the local override.
   * @param {string} scope
   * @param {string | null} scopeRefId
   */
  async function listForScope(scope, scopeRefId) {
    const ctx = await contextFor(scope, scopeRefId);
    const rows = await prisma.setting.findMany({ where: { OR: scopeTargets(ctx).map((t) => ({ scope: t.scope, scopeRefId: t.scopeRefId })) } });
    return SETTINGS.map((def) => {
      const forKey = rows.filter((r) => r.key === def.key);
      const winner = resolveScoped(forKey, ctx);
      const local = forKey.find((r) => r.scope === scope && (r.scopeRefId ?? null) === (scopeRefId ?? null)) ?? null;
      return {
        key: def.key,
        section: def.section,
        label: def.label,
        description: def.description,
        scopes: def.scopes,
        overridableHere: def.scopes.includes(scope),
        phase: def.phase,
        activeNow: def.phase <= CURRENT_PHASE,
        critical: Boolean(def.critical),
        placeholder: Boolean(def.placeholder),
        legalReview: Boolean(def.legalReview),
        default: def.default,
        effectiveValue: winner ? /** @type {any} */ (winner.winner).value : def.default,
        source: winner ? { scope: winner.winner.scope, scopeRefId: winner.winner.scopeRefId } : { scope: 'DEFAULT', scopeRefId: null },
        override: local ? { id: local.id, value: local.value, updatedAt: local.updatedAt } : null,
      };
    });
  }

  /**
   * Create or replace an override, with history and audit, in one transaction.
   * @param {import('../../core/types.js').JamzoRequest} request
   * @param {{ key: string, scope: string, scopeRefId?: string | null, value: unknown, reason?: string }} input
   */
  async function write(request, input) {
    const scopeRefId = input.scope === 'GLOBAL' ? null : input.scopeRefId ?? null;
    const checked = validateSetting(input.key, input.scope, input.value);
    if ('error' in checked) {
      const fieldErrors = checked.issues
        ? Object.fromEntries(checked.issues.map((i) => [['value', ...i.path].join('.'), [i.message]]))
        : { value: [checked.error] };
      throw new AppError('VALIDATION_FAILED', checked.error, { fieldErrors });
    }
    const rule = extraValidation(input.key, checked.value);
    if (rule) throw new AppError('VALIDATION_FAILED', rule, { fieldErrors: { value: [rule] } });
    const def = getSettingDefinition(input.key);
    if (def.critical && !input.reason) throw new AppError('VALIDATION_FAILED', 'A reason is required for this setting.', { fieldErrors: { reason: ['Required'] } });
    await contextFor(input.scope, scopeRefId);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findFirst({ where: { key: input.key, scope: input.scope, scopeRefId } });
      const row = existing
        ? await tx.setting.update({ where: { id: existing.id }, data: { value: checked.value, updatedById: request.auth.userId } })
        : await tx.setting.create({ data: { key: input.key, scope: input.scope, scopeRefId, value: checked.value, updatedById: request.auth.userId } });
      await tx.settingHistory.create({
        data: {
          settingId: row.id,
          key: input.key,
          scope: input.scope,
          scopeRefId,
          oldValue: existing?.value ?? undefined,
          newValue: checked.value,
          reason: input.reason,
          changedById: request.auth.userId,
        },
      });
      await audit(tx, request, {
        action: 'setting.update',
        entityType: 'setting',
        entityId: `${input.key}@${input.scope}${scopeRefId ? `:${scopeRefId}` : ''}`,
        oldValue: existing?.value ?? null,
        newValue: checked.value,
      });
      return row;
    });
    invalidate();
    return result;
  }

  /**
   * Remove an override so the value is inherited again ("Reset to inherited value", spec §32).
   * @param {import('../../core/types.js').JamzoRequest} request
   * @param {{ key: string, scope: string, scopeRefId?: string | null, reason?: string }} input
   */
  async function reset(request, input) {
    const scopeRefId = input.scope === 'GLOBAL' ? null : input.scopeRefId ?? null;
    const def = getSettingDefinition(input.key);
    if (!def) throw notFound('Setting');
    if (def.critical && !input.reason) throw new AppError('VALIDATION_FAILED', 'A reason is required for this setting.', { fieldErrors: { reason: ['Required'] } });
    await prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findFirst({ where: { key: input.key, scope: input.scope, scopeRefId } });
      if (!existing) throw notFound('Override');
      // History is kept: the FK is ON DELETE SET NULL and the row records key + scope + target itself.
      await tx.settingHistory.create({
        data: {
          settingId: existing.id,
          key: input.key,
          scope: input.scope,
          scopeRefId,
          oldValue: existing.value,
          newValue: undefined,
          reason: input.reason ?? 'Reset to inherited value',
          changedById: request.auth.userId,
        },
      });
      await tx.setting.delete({ where: { id: existing.id } });
      await audit(tx, request, {
        action: 'setting.reset',
        entityType: 'setting',
        entityId: `${input.key}@${input.scope}${scopeRefId ? `:${scopeRefId}` : ''}`,
        oldValue: existing.value,
        newValue: null,
      });
    });
    invalidate();
  }

  const flags = () => cached('flags', () => prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }));

  /** @param {string} appId @param {string} platform */
  const versionPolicy = (appId, platform) =>
    cached(`policy:${appId}:${platform}`, () => prisma.appVersionPolicy.findUnique({ where: { appId_platform: { appId, platform } } }));

  /**
   * Version status for a mobile client. A missing policy row means "no restriction configured".
   * @param {{ appId: string, platform: string | null, appVersion: string | null }} client
   */
  async function clientVersion(client) {
    const policy = client.platform ? await versionPolicy(client.appId, client.platform) : null;
    const p = policy ?? { minSupportedVersion: '0.0.0', recommendedVersion: '0.0.0', forceUpdate: false, storeUrl: null };
    return {
      status: versionStatus(client.appVersion, p),
      minSupportedVersion: p.minSupportedVersion,
      recommendedVersion: p.recommendedVersion,
      forceUpdate: p.forceUpdate,
      storeUrl: p.storeUrl ?? null,
    };
  }

  /**
   * Remote configuration payload for an app (CONFIGURATION.md §5).
   * @param {{ appId: string, platform: string | null, appVersion: string | null }} client
   * @param {{ userId?: string | null, cityId?: string | null }} [who]
   */
  async function remoteConfig(client, who = {}) {
    const ctx = who.cityId ? await contextFor('CITY', who.cityId).catch(() => ({})) : {};
    const [maintenance, support, methods, flagRows, version] = await Promise.all([
      resolve('maintenance'),
      resolve('support.contact', ctx),
      resolve('auth.methods'),
      flags(),
      clientVersion(client),
    ]);
    const maint = maintenance.value;
    return {
      appId: client.appId,
      platform: client.platform,
      maintenance: { enabled: maint.enabled && maint.apps.includes(client.appId), message: maint.message },
      version,
      auth: { methods: methods.value[client.appId] ?? [] },
      featureFlags: Object.fromEntries(
        flagRows.map((f) => [f.key, evaluateFlag({ key: f.key, enabled: f.enabled, rules: /** @type {any} */ (f.rules) }, { userId: who.userId, cityId: who.cityId, appId: client.appId, appVersion: client.appVersion })]),
      ),
      support: support.value,
      serverTime: clock.now().toISOString(),
    };
  }

  return { resolve, listForScope, write, reset, flags, versionPolicy, clientVersion, remoteConfig, contextFor, invalidate };
}
