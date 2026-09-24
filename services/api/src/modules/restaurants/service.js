// Restaurant onboarding rules shared by the admin and partner routes (RESTAURANTS.md §2–§3, D-34, D-41).
import { branchOpenState } from '@jamzo/catalog-engine';
import { pointInGeometry } from '@jamzo/delivery-engine';
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { canInCity } from '../../core/auth.js';

/**
 * Allowed onboarding transitions. `check` names the readiness level that must be fully satisfied.
 * @type {Record<string, Record<string, { permission: string, reason?: boolean, check?: 'submit' | 'approve' | 'live', label: string }>>}
 */
export const TRANSITIONS = {
  DRAFT: {
    REVIEW: { permission: 'restaurants.manage', check: 'submit', label: 'Submit for review' },
    DOCUMENTS_PENDING: { permission: 'restaurants.manage', reason: true, label: 'Waiting for documents' },
  },
  DOCUMENTS_PENDING: {
    REVIEW: { permission: 'restaurants.manage', check: 'submit', label: 'Submit for review' },
  },
  REVIEW: {
    APPROVED: { permission: 'restaurants.approve', check: 'approve', label: 'Approve' },
    DOCUMENTS_PENDING: { permission: 'restaurants.approve', reason: true, label: 'Request changes' },
  },
  APPROVED: {
    ACTIVE: { permission: 'restaurants.approve', check: 'live', label: 'Go live' },
  },
  ACTIVE: {
    SUSPENDED: { permission: 'restaurants.approve', reason: true, label: 'Suspend' },
  },
  SUSPENDED: {
    ACTIVE: { permission: 'restaurants.approve', reason: true, check: 'live', label: 'Reinstate' },
  },
};

const LEVELS = { submit: ['submit'], approve: ['submit', 'approve'], live: ['submit', 'approve', 'live'] };

const num = (d) => (d == null ? null : Number(d));

/** Relations every restaurant detail/readiness read needs. */
export const RESTAURANT_DETAIL_INCLUDE = {
  city: { include: { state: true } },
  settings: true,
  zones: { include: { zone: true } },
  branches: {
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    include: {
      businessHours: { orderBy: [{ dayOfWeek: 'asc' }, { opensAt: 'asc' }] },
      deliveryAreas: { where: { isActive: true } },
    },
  },
  documents: { orderBy: { createdAt: 'desc' } },
  bankAccounts: { orderBy: { createdAt: 'desc' } },
  users: { orderBy: { createdAt: 'asc' }, include: { user: true } },
};

/**
 * Loads a restaurant and enforces city scope for the admin (City Managers see only their city).
 * @param {import('../../core/types.js').JamzoRequest} request
 * @param {import('@jamzo/database').Db} db
 * @param {string} id
 * @param {string} permission
 * @param {object} [include]
 */
export async function loadRestaurantForAdmin(request, db, id, permission, include) {
  const restaurant = await db.restaurant.findUnique({ where: { id }, ...(include ? { include } : {}) });
  if (!restaurant) throw notFound('Restaurant');
  if (!canInCity(request, permission, restaurant.cityId))
    throw forbidden('You do not have access to restaurants in this city.');
  return restaurant;
}

/**
 * The zone containing a point within a city (smallest when zones overlap), or null.
 * @param {import('@jamzo/database').Db} db
 * @param {string} cityId
 * @param {{ lat: number, lng: number }} point
 */
export async function zoneForPoint(db, cityId, point) {
  const zones = await db.zone.findMany({
    where: {
      cityId,
      isActive: true,
      minLat: { lte: point.lat },
      maxLat: { gte: point.lat },
      minLng: { lte: point.lng },
      maxLng: { gte: point.lng },
    },
  });
  const inside = zones.filter((z) => pointInGeometry(point, /** @type {any} */ (z.geometry)));
  inside.sort(
    (a, b) =>
      (Number(a.maxLat) - Number(a.minLat)) * (Number(a.maxLng) - Number(a.minLng)) -
      (Number(b.maxLat) - Number(b.minLat)) * (Number(b.maxLng) - Number(b.minLng)),
  );
  return inside[0] ?? null;
}

/** Keeps restaurant_zones ⊇ the zones of the restaurant's branches (D-41). */
export async function syncBranchZones(tx, restaurantId) {
  const branches = await tx.restaurantBranch.findMany({
    where: { restaurantId, zoneId: { not: null } },
    select: { zoneId: true },
  });
  if (!branches.length) return;
  await tx.restaurantZone.createMany({
    data: [...new Set(branches.map((b) => b.zoneId))].map((zoneId) => ({ restaurantId, zoneId })),
    skipDuplicates: true,
  });
}

/**
 * The readiness checklist the server enforces for each transition (RESTAURANTS.md §2). The admin renders
 * exactly this list.
 * @param {any} r restaurant loaded with RESTAURANT_DETAIL_INCLUDE
 * @param {{ requiredKinds: string[], liveProducts: number, today: string }} ctx today = YYYY-MM-DD in the city
 */
export function evaluateReadiness(r, { requiredKinds, liveProducts, today }) {
  const checks = [];
  const add = (level, key, label, ok, detail = null) => checks.push({ level, key, label, ok, detail });

  const profileMissing = [!r.phone && 'contact phone', !r.cuisines?.length && 'at least one cuisine'].filter(
    Boolean,
  );
  add(
    'submit',
    'profile',
    'Profile complete',
    !profileMissing.length,
    profileMissing.length ? `Missing ${profileMissing.join(', ')}` : null,
  );

  const branchProblems = [];
  if (!r.branches.length) branchProblems.push('add a branch');
  for (const b of r.branches) {
    if (!b.zoneId) branchProblems.push(`${b.name}: location is outside every zone of ${r.city.name}`);
    if (!b.businessHours.length) branchProblems.push(`${b.name}: add opening hours`);
    if (!b.deliveryAreas.length) branchProblems.push(`${b.name}: set a delivery area`);
  }
  add(
    'submit',
    'branches',
    'Branch location, hours and delivery area',
    !branchProblems.length,
    branchProblems.join('; ') || null,
  );

  const docsFor = (kind) => r.documents.filter((d) => d.kind === kind);
  const notUploaded = requiredKinds.filter((k) => !docsFor(k).some((d) => d.status !== 'REJECTED'));
  add(
    'submit',
    'documents',
    'Required documents uploaded',
    !notUploaded.length,
    notUploaded.length ? `Missing ${notUploaded.join(', ')}` : null,
  );
  add('submit', 'bank', 'Bank account added', r.bankAccounts.length > 0);
  const owners = r.users.filter((u) => u.isActive && u.role === 'OWNER');
  add('submit', 'owner', 'An active owner on the team', owners.length > 0);

  const notVerified = requiredKinds.filter(
    (k) =>
      !docsFor(k).some(
        (d) => d.status === 'VERIFIED' && (!d.expiresOn || d.expiresOn.toISOString().slice(0, 10) > today),
      ),
  );
  add(
    'approve',
    'documentsVerified',
    'Required documents verified and not expired',
    !notVerified.length,
    notVerified.length ? `Not verified: ${notVerified.join(', ')}` : null,
  );
  add(
    'approve',
    'bankVerified',
    'Primary bank account verified',
    r.bankAccounts.some((b) => b.isPrimary && b.verifiedAt),
  );

  add('live', 'menu', 'At least one active, available product', liveProducts > 0);
  return checks;
}

/**
 * Validates a requested transition; returns its definition.
 * @param {import('../../core/types.js').JamzoRequest} request
 * @param {string} cityId
 * @param {string} from
 * @param {string} to
 * @param {{ reason?: string }} body
 * @param {ReturnType<typeof evaluateReadiness>} checks
 */
export function assertTransition(request, cityId, from, to, body, checks) {
  const t = TRANSITIONS[from]?.[to];
  if (!t) {
    throw new AppError('INVALID_STATE_TRANSITION', `A restaurant cannot move from ${from} to ${to}.`, {
      details: { from, to, allowed: Object.keys(TRANSITIONS[from] ?? {}) },
    });
  }
  if (!canInCity(request, t.permission, cityId))
    throw forbidden(`"${t.label}" needs the ${t.permission} permission.`);
  if (t.reason && !body.reason)
    throw new AppError('VALIDATION_FAILED', 'A reason is required for this change.', {
      fieldErrors: { reason: ['Required'] },
    });
  if (t.check) {
    const failing = checks.filter((c) => LEVELS[t.check].includes(c.level) && !c.ok);
    if (failing.length) {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        `Not ready to ${t.label.toLowerCase()}: ${failing.map((c) => c.label.toLowerCase()).join('; ')}.`,
        {
          details: { failing: failing.map(({ key, label, detail }) => ({ key, label, detail })) },
        },
      );
    }
  }
  return t;
}

/** Transitions offered to this admin from the current status. */
export function availableTransitions(request, r) {
  return Object.entries(TRANSITIONS[r.onboardingStatus] ?? {}).map(([to, t]) => ({
    to,
    label: t.label,
    permission: t.permission,
    requiresReason: Boolean(t.reason),
    check: t.check ?? null,
    allowed: canInCity(request, t.permission, r.cityId),
  }));
}

/** YYYY-MM-DD in a timezone. */
export function localDateString(now, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export const branchDto = (b, { now, timeZone, restaurantStatus }) => ({
  id: b.id,
  name: b.name,
  addressLine: b.addressLine,
  area: b.area,
  pincode: b.pincode,
  lat: num(b.lat),
  lng: num(b.lng),
  zoneId: b.zoneId,
  isPrimary: b.isPrimary,
  isOpen: b.isOpen,
  pausedUntil: b.pausedUntil,
  busyMode: b.busyMode,
  prepTimeMinutes: b.prepTimeMinutes,
  hours: (b.businessHours ?? []).map(({ id, dayOfWeek, opensAt, closesAt }) => ({
    id,
    dayOfWeek,
    opensAt,
    closesAt,
  })),
  deliveryArea: b.deliveryAreas?.[0]
    ? {
        id: b.deliveryAreas[0].id,
        kind: b.deliveryAreas[0].kind,
        radiusM: b.deliveryAreas[0].radiusM,
        geometry: b.deliveryAreas[0].geometry,
      }
    : null,
  openState: branchOpenState(
    { restaurantStatus, isOpen: b.isOpen, pausedUntil: b.pausedUntil, hours: b.businessHours ?? [] },
    now,
    timeZone,
  ),
  updatedAt: b.updatedAt,
});

export const bankAccountDto = (a) => ({
  id: a.id,
  accountHolderName: a.accountHolderName,
  accountNumberMasked: `•••• ${a.accountNumberLast4}`,
  accountNumberLast4: a.accountNumberLast4,
  ifsc: a.ifsc,
  bankName: a.bankName,
  upiId: a.upiId,
  isPrimary: a.isPrimary,
  createdById: a.createdById,
  verifiedById: a.verifiedById,
  verifiedAt: a.verifiedAt,
  createdAt: a.createdAt,
});

export const documentDto = (d) => ({
  id: d.id,
  kind: d.kind,
  number: d.number,
  status: d.status,
  expiresOn: d.expiresOn ? d.expiresOn.toISOString().slice(0, 10) : null,
  hasFile: Boolean(d.mediaId),
  reviewedById: d.reviewedById,
  reviewedAt: d.reviewedAt,
  reviewNote: d.reviewNote,
  createdAt: d.createdAt,
});

export const memberDto = (m) => ({
  id: m.id,
  role: m.role,
  isActive: m.isActive,
  createdAt: m.createdAt,
  user: { id: m.user.id, name: m.user.name, phone: m.user.phone },
});

/** Conditional status change: fails if someone else changed the status first. */
export async function moveStatus(tx, id, from, to) {
  const { count } = await tx.restaurant.updateMany({
    where: { id, onboardingStatus: from },
    data: { onboardingStatus: to },
  });
  if (count !== 1) throw conflict('The restaurant status changed meanwhile. Reload and try again.');
}
