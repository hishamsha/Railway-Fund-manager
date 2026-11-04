import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { agencySetupCodeTtlMs, hashRecoveryCode, newRecoveryCode } from '../auth/recovery.js';
import { getPrisma } from '../database/prisma.js';
import { ApiError } from '../middleware/api-error.js';

// The owner creates agency logins here; there is no public signup. A new login
// has no usable password. The owner passes the one-time setup code to the
// agency, who sets a password with POST /auth/reset-password.
const router = Router();
router.use(authenticate);
const uuid = z.uuid();
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const displayName = z.string().trim().min(1).max(120).nullable().optional();
const createBody = z.strictObject({ packager_id: uuid, email, display_name: displayName });
const updateBody = z.strictObject({ display_name: displayName, is_active: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');
const listQuery = z.object({ packager_id: uuid.optional() });

function ownerId(response: Response): string {
  return response.locals.auth.userId as string;
}
function serialize(user: { id: string; emailNormalized: string; displayName: string | null;
  packagerId: string | null; isActive: boolean; passwordChangedAt: Date | null; createdAt: Date; updatedAt: Date }) {
  return { id: user.id, email: user.emailNormalized, display_name: user.displayName,
    packager_id: user.packagerId, is_active: user.isActive, password_set: user.passwordChangedAt !== null,
    created_at: user.createdAt.toISOString(), updated_at: user.updatedAt.toISOString() };
}
function newSetupCode() {
  const code = newRecoveryCode();
  return { code, expiresAt: new Date(Date.now() + agencySetupCodeTtlMs) };
}

router.get('/', async (request, response, next) => {
  try {
    const query = listQuery.parse(request.query);
    const users = await getPrisma().appUser.findMany({
      where: { role: 'agency', agencyOwnerId: ownerId(response),
        ...(query.packager_id ? { packagerId: query.packager_id } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500,
    });
    response.json({ items: users.map(serialize) });
  } catch (error) { next(error); }
});

router.post('/', async (request, response, next) => {
  try {
    const body = createBody.parse(request.body);
    const owner = ownerId(response);
    const unusablePassword = await argon2.hash(randomBytes(32).toString('base64url'), { type: argon2.argon2id });
    const setup = newSetupCode();
    const user = await getPrisma().$transaction(async (tx) => {
      const packager = await tx.packager.findFirst({ where: { id: body.packager_id, ownerId: owner, isArchived: false },
        select: { id: true } });
      if (!packager) throw new ApiError(404, 'NOT_FOUND', 'Packager not found');
      const created = await tx.appUser.create({ data: {
        emailNormalized: body.email, displayName: body.display_name ?? null, passwordHash: unusablePassword,
        role: 'agency', agencyOwnerId: owner, packagerId: body.packager_id,
        passwordResetHash: hashRecoveryCode(setup.code), passwordResetExpiresAt: setup.expiresAt,
      } });
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'agency_user', entityId: created.id, action: 'create', afterJson: serialize(created) } });
      return created;
    });
    response.status(201).json({ agency_user: serialize(user), setup_code: setup.code,
      setup_code_expires_at: setup.expiresAt.toISOString() });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      next(new ApiError(409, 'EMAIL_IN_USE', 'That email already has a login')); return;
    }
    next(error);
  }
});

router.patch('/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const body = updateBody.parse(request.body);
    const owner = ownerId(response);
    const user = await getPrisma().$transaction(async (tx) => {
      const before = await tx.appUser.findFirst({ where: { id, role: 'agency', agencyOwnerId: owner } });
      if (!before) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      const updated = await tx.appUser.update({ where: { id }, data: {
        ...(body.display_name !== undefined ? { displayName: body.display_name } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
        ...(body.is_active === false ? { passwordResetHash: null, passwordResetExpiresAt: null } : {}),
      } });
      if (body.is_active === false) {
        await tx.authSession.updateMany({ where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revocationReason: 'agency_deactivated' } });
      }
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner, entityType: 'agency_user',
        entityId: id, action: 'edit', beforeJson: serialize(before), afterJson: serialize(updated) } });
      return updated;
    });
    response.json({ agency_user: serialize(user) });
  } catch (error) { next(error); }
});

// Also how an agency that forgot its password gets back in.
router.post('/:id/setup-code', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const owner = ownerId(response);
    const setup = newSetupCode();
    await getPrisma().$transaction(async (tx) => {
      const user = await tx.appUser.findFirst({ where: { id, role: 'agency', agencyOwnerId: owner },
        select: { isActive: true } });
      if (!user) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      if (!user.isActive) throw new ApiError(409, 'AGENCY_USER_INACTIVE', 'Reactivate this login first');
      await tx.appUser.update({ where: { id }, data: {
        passwordResetHash: hashRecoveryCode(setup.code), passwordResetExpiresAt: setup.expiresAt } });
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'agency_user', entityId: id, action: 'issue_setup_code' } });
    });
    response.json({ setup_code: setup.code, setup_code_expires_at: setup.expiresAt.toISOString() });
  } catch (error) { next(error); }
});

export { router as agencyUserRouter };
