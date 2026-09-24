// Restaurant onboarding (RESTAURANTS.md §2, D-34 … D-36, D-41) against real PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, adminWithRole, bearer, headers, multipart, startTestApp, TINY_PNG } from './helpers.js';

let ctx;
let token; // Super Admin
let unjha;
let mehsana;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

beforeAll(async () => {
  ctx = await startTestApp();
  token = (await adminLogin(ctx)).accessToken;
  unjha = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'unjha' } });
  mehsana = await ctx.prisma.city.findUniqueOrThrow({ where: { slug: 'mehsana' } });
});
afterAll(() => ctx?.stop());

const call = (method, url, payload, t = token, extra = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: bearer(t, 'ADMIN', extra),
    ...(payload !== undefined ? { payload } : {}),
  });

async function createRestaurant(overrides = {}, t = token) {
  const slug = `r-${Math.random().toString(36).slice(2, 8)}`;
  const res = await call(
    'POST',
    '/v1/admin/restaurants',
    { cityId: unjha.id, name: `Test ${slug}`, slug, cuisines: ['Gujarati'], ...overrides },
    t,
  );
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function uploadDocument(restaurantId, fields, file, t = token) {
  const body = multipart(fields, file);
  return ctx.app.inject({
    method: 'POST',
    url: `/v1/admin/restaurants/${restaurantId}/documents`,
    headers: { ...bearer(t), 'content-type': body.contentType },
    payload: body.payload,
  });
}

const detail = async (id, t = token) =>
  (await call('GET', `/v1/admin/restaurants/${id}`, undefined, t)).json();
const failing = (d, level) => d.readiness.filter((c) => c.level === level && !c.ok).map((c) => c.key);

describe('onboarding workflow (D-34)', () => {
  it('takes a restaurant from DRAFT to ACTIVE only when every check passes, and suspends with a reason', async () => {
    const r = await createRestaurant();
    expect(r.onboardingStatus).toBe('DRAFT');
    let d = await detail(r.id);
    expect(failing(d, 'submit').sort()).toEqual(['bank', 'branches', 'documents', 'owner', 'profile']);

    // Submitting too early is refused with the failing checks.
    let res = await call('POST', `/v1/admin/restaurants/${r.id}/transitions`, { to: 'REVIEW' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
    expect(res.json().error.details.failing.map((f) => f.key)).toContain('branches');

    // Profile, team, branch (zone derived from the location), hours, delivery area.
    expect((await call('PATCH', `/v1/admin/restaurants/${r.id}`, { phone: '9876543210' })).statusCode).toBe(
      200,
    );
    expect(
      (
        await call('POST', `/v1/admin/restaurants/${r.id}/members`, {
          phone: '9876500001',
          name: 'Owner',
          role: 'OWNER',
        })
      ).statusCode,
    ).toBe(201);
    res = await call('POST', `/v1/admin/restaurants/${r.id}/branches`, {
      name: 'Main',
      addressLine: 'Station Road, Unjha',
      lat: 23.805,
      lng: 72.39,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().zone.name).toBe('Unjha Central');
    const branchId = res.json().id;
    res = await call('PUT', `/v1/admin/branches/${branchId}/hours`, {
      hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, opensAt: '11:00', closesAt: '23:00' })),
    });
    expect(res.statusCode, res.body).toBe(200);
    res = await call('PUT', `/v1/admin/branches/${branchId}/delivery-area`, {
      kind: 'RADIUS',
      radiusM: 4000,
    });
    expect(res.json().branches[0].deliveryArea).toMatchObject({ kind: 'RADIUS', radiusM: 4000 });
    expect(res.json().zones.map((z) => z.slug)).toEqual(['unjha-central']); // restaurant listed in its branch zone

    // Documents (FSSAI with a PDF, PAN number only) and a bank account.
    res = await uploadDocument(
      r.id,
      { kind: 'FSSAI', number: '10026022000001', expiresOn: '2030-12-31' },
      { filename: 'fssai.pdf', contentType: 'application/pdf', content: PDF },
    );
    expect(res.statusCode, res.body).toBe(201);
    res = await uploadDocument(r.id, { kind: 'PAN', number: 'abcde1234f' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().number).toBe('ABCDE1234F');
    res = await call('POST', `/v1/admin/restaurants/${r.id}/bank-accounts`, {
      accountHolderName: 'Test Foods',
      accountNumber: '5010 0012 3456 78',
      confirmAccountNumber: '50100012345678',
      ifsc: 'hdfc0001234',
    });
    expect(res.statusCode, res.body).toBe(201);
    const bankId = res.json().id;

    d = await detail(r.id);
    expect(failing(d, 'submit')).toEqual([]);
    res = await call('POST', `/v1/admin/restaurants/${r.id}/transitions`, { to: 'REVIEW' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().onboardingStatus).toBe('REVIEW');

    // Approval needs verified documents and a verified bank account.
    res = await call('POST', `/v1/admin/restaurants/${r.id}/transitions`, { to: 'APPROVED' });
    expect(res.statusCode).toBe(409);
    expect(
      res
        .json()
        .error.details.failing.map((f) => f.key)
        .sort(),
    ).toEqual(['bankVerified', 'documentsVerified']);
    for (const doc of d.documents) {
      expect(
        (await call('POST', `/v1/admin/restaurant-documents/${doc.id}/review`, { status: 'VERIFIED' }))
          .statusCode,
      ).toBe(200);
    }
    // Four-eyes: the admin who entered the bank details cannot verify them.
    res = await call('POST', `/v1/admin/restaurant-bank-accounts/${bankId}/verify`, {});
    expect(res.statusCode).toBe(403);
    const partnerManager = await adminWithRole(ctx, 'PARTNER_MANAGER');
    res = await call(
      'POST',
      `/v1/admin/restaurant-bank-accounts/${bankId}/verify`,
      {},
      partnerManager.accessToken,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ isPrimary: true, accountNumberLast4: '5678' });

    res = await call('POST', `/v1/admin/restaurants/${r.id}/transitions`, { to: 'APPROVED' });
    expect(res.statusCode, res.body).toBe(200);

    // Going live needs an active, available product.
    res = await call('POST', `/v1/admin/restaurants/${r.id}/transitions`, { to: 'ACTIVE' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.failing.map((f) => f.key)).toEqual(['menu']);
    res = await call('POST', '/v1/admin/products', {
      restaurantId: r.id,
      name: 'Gujarati Thali',
      basePricePaise: 18000,
    });
    expect(res.statusCode, res.body).toBe(201);
    res = await call('POST', `/v1/admin/restaurants/${r.id}/transitions`, { to: 'ACTIVE' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().branches[0].openState.reason).not.toBe('RESTAURANT_NOT_ACTIVE');

    // Suspension needs a reason; the move is audit-logged with it.
    expect(
      (await call('POST', `/v1/admin/restaurants/${r.id}/transitions`, { to: 'SUSPENDED' })).statusCode,
    ).toBe(400);
    res = await call('POST', `/v1/admin/restaurants/${r.id}/transitions`, {
      to: 'SUSPENDED',
      reason: 'Hygiene complaint under review',
    });
    expect(res.json().onboardingStatus).toBe('SUSPENDED');
    const logs = await ctx.prisma.auditLog.findMany({
      where: { entityId: r.id, action: 'restaurant.status_change' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.newValue.onboardingStatus)).toEqual([
      'REVIEW',
      'APPROVED',
      'ACTIVE',
      'SUSPENDED',
    ]);
    expect(logs.at(-1).newValue.reason).toBe('Hygiene complaint under review');

    // Undefined transitions are refused.
    res = await call('POST', `/v1/admin/restaurants/${r.id}/transitions`, { to: 'DRAFT' });
    expect(res.json().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('two concurrent submissions: exactly one wins', async () => {
    const ready = await createReadyDraft();
    const results = await Promise.all([
      call('POST', `/v1/admin/restaurants/${ready}/transitions`, { to: 'REVIEW' }),
      call('POST', `/v1/admin/restaurants/${ready}/transitions`, { to: 'REVIEW' }),
    ]);
    expect(results.map((x) => x.statusCode).sort()).toEqual([200, 409]);
    expect((await ctx.prisma.restaurant.findUniqueOrThrow({ where: { id: ready } })).onboardingStatus).toBe(
      'REVIEW',
    );
    expect(
      await ctx.prisma.auditLog.count({ where: { entityId: ready, action: 'restaurant.status_change' } }),
    ).toBe(1);
  });

  it('requires the approve permission for approval steps', async () => {
    const ops = await adminWithRole(ctx, 'OPERATIONS'); // restaurants.manage but not restaurants.approve
    const id = await createReadyDraft();
    expect(
      (await call('POST', `/v1/admin/restaurants/${id}/transitions`, { to: 'REVIEW' }, ops.accessToken))
        .statusCode,
    ).toBe(200);
    const res = await call(
      'POST',
      `/v1/admin/restaurants/${id}/transitions`,
      { to: 'APPROVED' },
      ops.accessToken,
    );
    expect(res.statusCode).toBe(403);
    expect((await detail(id, ops.accessToken)).transitions.find((t) => t.to === 'APPROVED').allowed).toBe(
      false,
    );
  });
});

/** A DRAFT restaurant that passes every submit check (set up directly, not under test here). */
async function createReadyDraft() {
  const r = await createRestaurant({ phone: '9876543211' });
  const user = await ctx.prisma.user.create({
    data: { phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}` },
  });
  await ctx.prisma.restaurantUser.create({ data: { restaurantId: r.id, userId: user.id, role: 'OWNER' } });
  const zone = await ctx.prisma.zone.findFirstOrThrow({ where: { slug: 'unjha-central' } });
  await ctx.prisma.restaurantBranch.create({
    data: {
      restaurantId: r.id,
      name: 'Main',
      addressLine: 'Main Road',
      lat: 23.805,
      lng: 72.39,
      zoneId: zone.id,
      businessHours: { create: [{ dayOfWeek: 1, opensAt: '10:00', closesAt: '22:00' }] },
      deliveryAreas: { create: { kind: 'RADIUS', radiusM: 3000 } },
    },
  });
  await ctx.prisma.restaurantDocument.createMany({
    data: [
      { restaurantId: r.id, kind: 'FSSAI', number: '10026022000002' },
      { restaurantId: r.id, kind: 'PAN', number: 'ABCDE1234F' },
    ],
  });
  await ctx.prisma.restaurantBankAccount.create({
    data: {
      restaurantId: r.id,
      accountHolderName: 'X',
      accountNumberEncrypted: ctx.fieldCipher.encrypt('123456789'),
      accountNumberLast4: '6789',
      ifsc: 'HDFC0001234',
    },
  });
  return r.id;
}

describe('private documents (D-36)', () => {
  it('stores files privately, serves them only to admins with an audit entry, and keeps them out of the media library', async () => {
    const r = await createRestaurant();
    let res = await uploadDocument(
      r.id,
      { kind: 'GST', number: '24ABCDE1234F1Z5' },
      { filename: 'gst.png', contentType: 'image/png', content: TINY_PNG },
    );
    expect(res.statusCode, res.body).toBe(201);
    const doc = res.json();
    expect(doc.hasFile).toBe(true);
    const row = await ctx.prisma.restaurantDocument.findUniqueOrThrow({ where: { id: doc.id } });
    const media = await ctx.prisma.media.findUniqueOrThrow({ where: { id: row.mediaId } });
    expect(media.kind).toBe('DOCUMENT');
    expect(media.storageKey.startsWith('private/documents/')).toBe(true);

    // The public file route never serves it — not by its key, not dressed up as a media key.
    for (const url of [
      `/v1/media/files/${media.storageKey}`,
      `/v1/media/files/media/${media.id}/original.png`,
    ]) {
      expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
    const library = (await call('GET', '/v1/admin/media')).json();
    expect(library.items.find((m) => m.id === media.id)).toBeUndefined();
    expect((await call('GET', `/v1/admin/media/${media.id}`)).statusCode).toBe(404);

    res = await call('GET', `/v1/admin/restaurant-documents/${doc.id}/file`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(res.rawPayload, TINY_PNG)).toBe(0);
    expect(
      await ctx.prisma.auditLog.count({ where: { action: 'restaurant_document.view', entityId: r.id } }),
    ).toBe(1);

    // Signed-out and other apps cannot fetch it.
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/v1/admin/restaurant-documents/${doc.id}/file`,
          headers: headers('ADMIN'),
        })
      ).statusCode,
    ).toBe(401);
  });

  it('validates document numbers and content types', async () => {
    const r = await createRestaurant();
    let res = await uploadDocument(r.id, { kind: 'FSSAI', number: '12345' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fieldErrors.number).toBeTruthy();
    res = await uploadDocument(
      r.id,
      { kind: 'OTHER' },
      {
        filename: 'x.svg',
        contentType: 'image/svg+xml',
        content: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      },
    );
    expect(res.statusCode).toBe(415);
    res = await uploadDocument(r.id, { kind: 'OTHER' });
    expect(res.statusCode).toBe(400); // neither a file nor a number
    const rejected = await uploadDocument(r.id, { kind: 'PAN', number: 'ABCDE1234F' });
    res = await call('POST', `/v1/admin/restaurant-documents/${rejected.json().id}/review`, {
      status: 'REJECTED',
    });
    expect(res.statusCode).toBe(400); // rejection needs a note
  });
});

describe('bank accounts (D-35)', () => {
  it('never returns or logs the account number, stores it encrypted, and checks the confirmation', async () => {
    const r = await createRestaurant();
    let res = await call('POST', `/v1/admin/restaurants/${r.id}/bank-accounts`, {
      accountHolderName: 'Test Foods',
      accountNumber: '123456789012',
      confirmAccountNumber: '123456789013',
      ifsc: 'HDFC0001234',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fieldErrors.confirmAccountNumber).toBeTruthy();

    res = await call('POST', `/v1/admin/restaurants/${r.id}/bank-accounts`, {
      accountHolderName: 'Test Foods',
      accountNumber: '123456789012',
      confirmAccountNumber: '123456789012',
      ifsc: 'HDFC0001234',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('123456789012');
    expect(res.json()).toMatchObject({
      accountNumberMasked: '•••• 9012',
      isPrimary: false,
      verifiedAt: null,
    });
    const row = await ctx.prisma.restaurantBankAccount.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(row.accountNumberEncrypted).not.toContain('123456789012');
    expect(ctx.fieldCipher.decrypt(row.accountNumberEncrypted)).toBe('123456789012');
    const audits = await ctx.prisma.auditLog.findMany({ where: { entityId: r.id } });
    expect(JSON.stringify(audits)).not.toContain('123456789012');
    expect(JSON.stringify((await call('GET', `/v1/admin/restaurants/${r.id}`)).json())).not.toContain(
      '123456789012',
    );
  });

  it('verifying a new account makes it primary and demotes the old one atomically', async () => {
    const r = await createRestaurant();
    const pm = await adminWithRole(ctx, 'PARTNER_MANAGER');
    const add = async (n) =>
      (
        await call('POST', `/v1/admin/restaurants/${r.id}/bank-accounts`, {
          accountHolderName: 'Test Holder',
          accountNumber: n,
          confirmAccountNumber: n,
          ifsc: 'SBIN0001234',
        })
      ).json().id;
    const first = await add('111122223333');
    await call('POST', `/v1/admin/restaurant-bank-accounts/${first}/verify`, {}, pm.accessToken);
    const second = await add('444455556666');
    const res = await call('POST', `/v1/admin/restaurant-bank-accounts/${second}/verify`, {}, pm.accessToken);
    expect(res.statusCode).toBe(200);
    const accounts = (await detail(r.id)).bankAccounts;
    expect(accounts.filter((a) => a.isPrimary).map((a) => a.id)).toEqual([second]);
    expect(
      (await call('POST', `/v1/admin/restaurant-bank-accounts/${second}/verify`, {}, pm.accessToken))
        .statusCode,
    ).toBe(409);
  });
});

describe('branches, hours and zones', () => {
  it('validates hours: overlaps rejected, lunch + dinner and past midnight accepted', async () => {
    const r = await createRestaurant();
    const b = (
      await call('POST', `/v1/admin/restaurants/${r.id}/branches`, {
        name: 'Main',
        addressLine: 'Main Road, Unjha',
        lat: 23.805,
        lng: 72.39,
      })
    ).json();
    let res = await call('PUT', `/v1/admin/branches/${b.id}/hours`, {
      hours: [
        { dayOfWeek: 1, opensAt: '11:00', closesAt: '15:00' },
        { dayOfWeek: 1, opensAt: '14:00', closesAt: '23:00' },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fieldErrors['hours.1.start']).toBeTruthy();
    res = await call('PUT', `/v1/admin/branches/${b.id}/hours`, {
      hours: [
        { dayOfWeek: 1, opensAt: '11:00', closesAt: '15:00' },
        { dayOfWeek: 1, opensAt: '18:00', closesAt: '01:00' },
        { dayOfWeek: 2, opensAt: '11:00', closesAt: '24:00' },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().branches[0].hours).toHaveLength(3);
  });

  it('a branch outside every zone gets no zone and blocks submission', async () => {
    const r = await createRestaurant();
    const res = await call('POST', `/v1/admin/restaurants/${r.id}/branches`, {
      name: 'Far',
      addressLine: 'Far away road',
      lat: 23.9,
      lng: 72.5,
    });
    expect(res.json().zone).toBeNull();
    const d = await detail(r.id);
    expect(d.readiness.find((c) => c.key === 'branches').detail).toMatch(/outside every zone/);
  });

  it('pause is limited by the restaurants.operations setting, and resumes with 0', async () => {
    const r = await createRestaurant();
    const b = (
      await call('POST', `/v1/admin/restaurants/${r.id}/branches`, {
        name: 'Main',
        addressLine: 'Main Road, Unjha',
        lat: 23.805,
        lng: 72.39,
      })
    ).json();
    expect((await call('PATCH', `/v1/admin/branches/${b.id}`, { pauseMinutes: 180 })).statusCode).toBe(400);
    // A BRANCH-scoped override raises the limit for this branch only (D-40).
    const set = await call('PUT', '/v1/admin/settings', {
      key: 'restaurants.operations',
      scope: 'BRANCH',
      scopeRefId: b.id,
      value: { maxPauseMinutes: 240, busyExtraPrepMinutes: 10 },
    });
    expect(set.statusCode, set.body).toBe(200);
    let res = await call('PATCH', `/v1/admin/branches/${b.id}`, { pauseMinutes: 180 });
    expect(res.statusCode, res.body).toBe(200);
    const until = new Date(res.json().branches[0].pausedUntil).getTime();
    expect(Math.abs(until - (ctx.clock.now().getTime() + 180 * 60_000))).toBeLessThan(5000);
    res = await call('PATCH', `/v1/admin/branches/${b.id}`, { pauseMinutes: 0 });
    expect(res.json().branches[0].pausedUntil).toBeNull();
    expect((await call('PATCH', `/v1/admin/branches/${b.id}`, { prepTimeMinutes: 90 })).statusCode).toBe(400); // max 60 by default
  });

  it('restaurant zones must be in its city and always include branch zones', async () => {
    const r = await createRestaurant();
    await call('POST', `/v1/admin/restaurants/${r.id}/branches`, {
      name: 'Main',
      addressLine: 'Main Road, Unjha',
      lat: 23.805,
      lng: 72.39,
    });
    const north = await ctx.prisma.zone.findFirstOrThrow({ where: { slug: 'unjha-north' } });
    const mehsanaZone = await ctx.prisma.zone.findFirstOrThrow({ where: { slug: 'mehsana-central' } });
    expect(
      (await call('PUT', `/v1/admin/restaurants/${r.id}/zones`, { zoneIds: [mehsanaZone.id] })).statusCode,
    ).toBe(400);
    const res = await call('PUT', `/v1/admin/restaurants/${r.id}/zones`, { zoneIds: [north.id] });
    expect(
      res
        .json()
        .zones.map((z) => z.slug)
        .sort(),
    ).toEqual(['unjha-central', 'unjha-north']);
  });
});

describe('team', () => {
  it('adds members by phone without approving anyone, and keeps at least one owner after draft', async () => {
    const id = await createReadyDraft();
    const res = await call('POST', `/v1/admin/restaurants/${id}/members`, {
      phone: '9876500099',
      role: 'STAFF',
    });
    expect(res.statusCode).toBe(201);
    expect(
      (await call('POST', `/v1/admin/restaurants/${id}/members`, { phone: '9876500099', role: 'MANAGER' }))
        .statusCode,
    ).toBe(409);
    await call('POST', `/v1/admin/restaurants/${id}/transitions`, { to: 'REVIEW' });
    const owner = (await detail(id)).members.find((m) => m.role === 'OWNER');
    expect(
      (await call('PATCH', `/v1/admin/restaurant-members/${owner.id}`, { isActive: false, reason: 'Left' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call('PATCH', `/v1/admin/restaurant-members/${res.json().id}`, { isActive: false })).statusCode,
    ).toBe(400); // reason
  });
});

describe('access control', () => {
  it('City Managers see and change only their own city; roles without manage cannot create', async () => {
    const own = await adminWithRole(ctx, 'CITY_MANAGER', { cityId: unjha.id });
    const other = await adminWithRole(ctx, 'CITY_MANAGER', { cityId: mehsana.id });
    const r = await createRestaurant();
    expect((await call('GET', `/v1/admin/restaurants/${r.id}`, undefined, own.accessToken)).statusCode).toBe(
      200,
    );
    expect(
      (await call('GET', `/v1/admin/restaurants/${r.id}`, undefined, other.accessToken)).statusCode,
    ).toBe(403);
    const list = (await call('GET', '/v1/admin/restaurants?limit=100', undefined, other.accessToken)).json();
    expect(list.items).toHaveLength(0);
    const create = await call(
      'POST',
      '/v1/admin/restaurants',
      { cityId: unjha.id, name: 'Nope', slug: 'nope-city' },
      other.accessToken,
    );
    expect(create.statusCode).toBe(403);
    const support = await adminWithRole(ctx, 'SUPPORT');
    expect(
      (
        await call(
          'POST',
          '/v1/admin/restaurants',
          { cityId: unjha.id, name: 'Nope', slug: 'nope-support' },
          support.accessToken,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('GET', `/v1/admin/restaurants/${r.id}`, undefined, support.accessToken)).statusCode,
    ).toBe(200);
  });

  it('pure veg cannot be switched on while the menu has egg items', async () => {
    const r = await createRestaurant({ isPureVeg: false });
    await call('POST', '/v1/admin/products', {
      restaurantId: r.id,
      name: 'Masala Omelette',
      basePricePaise: 7000,
      foodType: 'EGG',
    });
    const res = await call('PATCH', `/v1/admin/restaurants/${r.id}`, { isPureVeg: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.fieldErrors.isPureVeg).toBeTruthy();
  });

  it('lists with search, city and status filters', async () => {
    const r = await createRestaurant({ name: 'Unique Zebra Cafe' });
    const res = await call('GET', `/v1/admin/restaurants?q=zebra&status=DRAFT&cityId=${unjha.id}`);
    expect(res.json().items.map((x) => x.id)).toEqual([r.id]);
  });
});
