// RBAC administration (RBAC.md). Guarantees: no self-escalation, Super Admin only managed by rbac.super,
// the last active Super Admin cannot be removed, city-scoped roles require a city.
import { z } from 'zod';
import { PERMISSIONS, SYSTEM_ROLES, hashPassword, isPermission } from '@jamzo/auth';
import { adminUserCreateBody, adminUserUpdateBody, pageQuery, roleCreateBody, roleUpdateBody, uuid } from '@jamzo/validation';
import { isUniqueViolation } from '@jamzo/database';
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';
import { parse } from '../../core/validate.js';
import { audit } from '../../core/audit.js';
import { allPermissions } from '../../core/auth.js';
import { idPage, toPage } from '../../core/pagination.js';
import { withIdempotency } from '../../core/idempotency.js';

const CITY_SCOPED_ROLES = new Set(SYSTEM_ROLES.filter((r) => r.cityScoped).map((r) => r.key));
const idParam = z.object({ id: uuid });

/** @param {import('../../core/types.js').JamzoApp} app */
export default async function rbacRoutes(app) {
  const prisma = app.prisma;
  const { auth } = app.services;

  const heldBy = (request) => allPermissions(request.auth.admin);

  /** Refuses grants/permissions the caller does not hold (RBAC.md §1.5). */
  function assertNoEscalation(request, permissionKeys) {
    const held = heldBy(request);
    const missing = permissionKeys.filter((p) => !held.has(p));
    if (missing.length) throw forbidden(`You cannot grant permissions you do not have: ${missing.join(', ')}.`);
  }

  async function loadGrantRoles(grants) {
    const roles = await prisma.role.findMany({ where: { id: { in: grants.map((g) => g.roleId) } }, include: { permissions: { include: { permission: true } } } });
    const byId = new Map(roles.map((r) => [r.id, r]));
    for (const g of grants) {
      const role = byId.get(g.roleId);
      if (!role) throw new AppError('VALIDATION_FAILED', 'Unknown role.', { fieldErrors: { grants: [`Unknown role ${g.roleId}`] } });
      if (CITY_SCOPED_ROLES.has(role.key) && !g.cityId) throw new AppError('VALIDATION_FAILED', `${role.name} must be limited to a city.`, { fieldErrors: { grants: ['City required'] } });
    }
    const cityIds = grants.map((g) => g.cityId).filter(Boolean);
    if (cityIds.length && (await prisma.city.count({ where: { id: { in: cityIds } } })) !== new Set(cityIds).size) {
      throw new AppError('VALIDATION_FAILED', 'Unknown city in grants.', { fieldErrors: { grants: ['Unknown city'] } });
    }
    return byId;
  }

  function assertGrantsAllowed(request, grants, byId) {
    for (const g of grants) {
      const role = byId.get(g.roleId);
      if (role.key === 'SUPER_ADMIN' && !heldBy(request).has('rbac.super')) throw forbidden('Only a Super Admin can grant Super Admin.');
      assertNoEscalation(request, role.permissions.map((rp) => rp.permission.key));
    }
  }

  const activeSuperAdmins = (tx, excludingAdminId) =>
    tx.adminUser.count({ where: { isActive: true, id: excludingAdminId ? { not: excludingAdminId } : undefined, roles: { some: { role: { key: 'SUPER_ADMIN' }, cityId: null } } } });

  // ── Permissions & roles ──
  app.get('/v1/admin/permissions', { config: { permission: 'roles.view' } }, async () => ({ items: PERMISSIONS }));

  app.get('/v1/admin/roles', { config: { permission: 'roles.view' } }, async () => {
    const roles = await prisma.role.findMany({ orderBy: [{ isSystem: 'desc' }, { name: 'asc' }], include: { permissions: { include: { permission: true } }, _count: { select: { admins: true } } } });
    return { items: roles.map(roleDto) };
  });

  app.get('/v1/admin/roles/:id', { config: { permission: 'roles.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    const role = await prisma.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } }, _count: { select: { admins: true } } } });
    if (!role) throw notFound('Role');
    return roleDto(role);
  });

  app.post('/v1/admin/roles', { config: { permission: 'roles.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const body = parse(roleCreateBody, request.body);
    const unknown = body.permissions.filter((p) => !isPermission(p));
    if (unknown.length) throw new AppError('VALIDATION_FAILED', 'Unknown permissions.', { fieldErrors: { permissions: unknown } });
    if (body.permissions.includes('rbac.super')) throw forbidden('rbac.super is reserved for the Super Admin role.');
    assertNoEscalation(request, body.permissions);
    const ids = await permissionIds(body.permissions);
    return withIdempotency(request, reply, { successStatus: 201 }, () =>
      prisma.$transaction(async (tx) => {
        let role;
        try {
          role = await tx.role.create({
            data: { key: body.key, name: body.name, description: body.description, isSystem: false, permissions: { create: ids.map((permissionId) => ({ permissionId })) } },
            include: { permissions: { include: { permission: true } }, _count: { select: { admins: true } } },
          });
        } catch (err) {
          if (isUniqueViolation(err)) throw conflict('A role with this key already exists.');
          throw err;
        }
        await audit(tx, request, { action: 'role.create', entityType: 'role', entityId: role.id, newValue: roleDto(role) });
        return roleDto(role);
      }),
    );
  });

  app.patch('/v1/admin/roles/:id', { config: { permission: 'roles.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(roleUpdateBody.extend({ reason: z.string().trim().min(3).max(500).optional() }), request.body);
    return prisma.$transaction(async (tx) => {
      const before = await tx.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } }, _count: { select: { admins: true } } } });
      if (!before) throw notFound('Role');
      if (before.key === 'SUPER_ADMIN') throw forbidden('The Super Admin role always has every permission and cannot be edited.');
      if (body.permissions) {
        const unknown = body.permissions.filter((p) => !isPermission(p));
        if (unknown.length) throw new AppError('VALIDATION_FAILED', 'Unknown permissions.', { fieldErrors: { permissions: unknown } });
        if (body.permissions.includes('rbac.super')) throw forbidden('rbac.super is reserved for the Super Admin role.');
        const current = before.permissions.map((rp) => rp.permission.key);
        const added = body.permissions.filter((p) => !current.includes(p));
        assertNoEscalation(request, added);
        if (!body.reason) throw new AppError('VALIDATION_FAILED', 'A reason is required when changing permissions.', { fieldErrors: { reason: ['Required'] } });
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        const ids = await permissionIds(body.permissions);
        await tx.rolePermission.createMany({ data: ids.map((permissionId) => ({ roleId: id, permissionId })) });
      }
      const after = await tx.role.update({
        where: { id },
        data: { name: body.name ?? undefined, description: body.description ?? undefined },
        include: { permissions: { include: { permission: true } }, _count: { select: { admins: true } } },
      });
      await audit(tx, request, { action: 'role.update', entityType: 'role', entityId: id, oldValue: roleDto(before), newValue: { ...roleDto(after), reason: body.reason ?? null } });
      return roleDto(after);
    });
  });

  app.delete('/v1/admin/roles/:id', { config: { permission: 'roles.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const { id } = parse(idParam, request.params);
    await prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({ where: { id }, include: { _count: { select: { admins: true } }, permissions: { include: { permission: true } } } });
      if (!role) throw notFound('Role');
      if (role.isSystem) throw forbidden('System roles cannot be deleted.');
      if (role._count.admins > 0) throw conflict('Remove this role from all admins before deleting it.');
      await tx.role.delete({ where: { id } });
      await audit(tx, request, { action: 'role.delete', entityType: 'role', entityId: id, oldValue: roleDto(role) });
    });
    reply.code(204);
    return null;
  });

  async function permissionIds(keys) {
    const rows = await prisma.permission.findMany({ where: { key: { in: keys } } });
    return rows.map((r) => r.id);
  }

  // ── Admin users ──
  app.get('/v1/admin/users', { config: { permission: 'admins.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const q = parse(pageQuery.extend({ status: z.enum(['active', 'inactive']).optional() }), request.query);
    const page = idPage(q);
    const rows = await prisma.adminUser.findMany({
      where: {
        ...page.where,
        ...(q.status ? { isActive: q.status === 'active' } : {}),
        ...(q.q ? { user: { OR: [{ email: { contains: q.q.toLowerCase() } }, { name: { contains: q.q, mode: 'insensitive' } }] } } : {}),
      },
      orderBy: page.orderBy,
      take: page.take,
      include: { user: true, roles: { include: { role: true } } },
    });
    return toPage(rows.map(adminDto), q.limit);
  });

  app.get('/v1/admin/users/:id', { config: { permission: 'admins.view' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    const admin = await prisma.adminUser.findUnique({ where: { id }, include: { user: true, roles: { include: { role: true } } } });
    if (!admin) throw notFound('Admin user');
    return adminDto(admin);
  });

  app.post('/v1/admin/users', { config: { permission: 'admins.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request, reply) => {
    const body = parse(adminUserCreateBody, request.body);
    const byId = await loadGrantRoles(body.grants);
    assertGrantsAllowed(request, body.grants, byId);
    const passwordHash = await hashPassword(body.password);
    return withIdempotency(request, reply, { successStatus: 201, fingerprint: { ...body, password: undefined } }, () =>
      prisma.$transaction(async (tx) => {
        if (await tx.user.findUnique({ where: { email: body.email } })) throw conflict('An account with this email already exists.');
        const user = await tx.user.create({
          data: {
            email: body.email,
            name: body.name,
            passwordHash,
            identities: { create: { provider: 'PASSWORD', subject: body.email } },
            adminUser: { create: { roles: { create: body.grants.map((g) => ({ roleId: g.roleId, cityId: g.cityId ?? null })) } } },
          },
          include: { adminUser: { include: { user: true, roles: { include: { role: true } } } } },
        });
        const dto = adminDto(user.adminUser);
        await audit(tx, request, { action: 'admin_user.create', entityType: 'admin_user', entityId: dto.id, newValue: dto });
        return dto;
      }),
    );
  });

  app.patch('/v1/admin/users/:id', { config: { permission: 'admins.manage' } }, async (/** @type {import('../../core/types.js').JamzoRequest} */ request) => {
    const { id } = parse(idParam, request.params);
    const body = parse(adminUserUpdateBody, request.body);
    let byId = null;
    if (body.grants) {
      byId = await loadGrantRoles(body.grants);
      assertGrantsAllowed(request, body.grants, byId);
    }
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.adminUser.findUnique({ where: { id }, include: { user: true, roles: { include: { role: true } } } });
      if (!before) throw notFound('Admin user');
      const targetIsSuper = before.roles.some((g) => g.role.key === 'SUPER_ADMIN');
      if (targetIsSuper && !heldBy(request).has('rbac.super')) throw forbidden('Only a Super Admin can change a Super Admin.');
      if (before.userId === request.auth.userId && (body.isActive === false || body.grants)) {
        throw forbidden('You cannot deactivate yourself or change your own roles.');
      }
      if ((body.isActive !== undefined || body.grants) && !body.reason) {
        throw new AppError('VALIDATION_FAILED', 'A reason is required to change status or roles.', { fieldErrors: { reason: ['Required'] } });
      }
      const losesSuper = targetIsSuper && (body.isActive === false || (body.grants && !body.grants.some((g) => byId.get(g.roleId).key === 'SUPER_ADMIN' && !g.cityId)));
      if (losesSuper && (await activeSuperAdmins(tx, id)) === 0) throw conflict('This is the last active Super Admin.');

      if (body.grants) {
        await tx.adminUserRole.deleteMany({ where: { adminUserId: id } });
        await tx.adminUserRole.createMany({ data: body.grants.map((g) => ({ adminUserId: id, roleId: g.roleId, cityId: g.cityId ?? null })) });
      }
      await tx.adminUser.update({ where: { id }, data: { isActive: body.isActive ?? undefined } });
      if (body.name) await tx.user.update({ where: { id: before.userId }, data: { name: body.name } });
      const after = await tx.adminUser.findUniqueOrThrow({ where: { id }, include: { user: true, roles: { include: { role: true } } } });
      await audit(tx, request, { action: 'admin_user.update', entityType: 'admin_user', entityId: id, oldValue: adminDto(before), newValue: { ...adminDto(after), reason: body.reason ?? null } });
      return { before, after };
    });
    if (body.isActive === false) await auth.revokeAllForUser(result.before.userId, 'ADMIN_DEACTIVATED');
    return adminDto(result.after);
  });
}

function roleDto(role) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: role.permissions.map((rp) => rp.permission.key).sort(),
    adminCount: role._count?.admins ?? undefined,
    cityScoped: CITY_SCOPED_ROLES.has(role.key),
  };
}

function adminDto(a) {
  return {
    id: a.id,
    userId: a.userId,
    email: a.user.email,
    name: a.user.name,
    isActive: a.isActive,
    lastLoginAt: a.lastLoginAt,
    lockedUntil: a.lockedUntil,
    createdAt: a.createdAt,
    grants: a.roles.map((g) => ({ roleId: g.roleId, roleKey: g.role.key, roleName: g.role.name, cityId: g.cityId })),
  };
}
