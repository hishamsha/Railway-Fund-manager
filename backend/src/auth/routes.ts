import { Router, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import argon2 from 'argon2';
import { z } from 'zod';
import { getPrisma } from '../database/prisma.js';
import { accessTtlSeconds, hashRefreshToken, newRefreshToken, signAccessToken, verifyAccessToken } from './crypto.js';
import { hashRecoveryCode } from './recovery.js';

const router = Router();
const generic = { error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } };
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const loginBody = z.strictObject({ email, password: z.string().min(1).max(1024) });
const refreshBody = z.strictObject({ refresh_token: z.string().min(40).max(200) });
const passwordBody = z.strictObject({ current_password: z.string(), new_password: z.string().min(12).max(1024) });
const resetBody = z.strictObject({ email, recovery_code: z.string().trim().min(16).max(64), new_password: z.string().min(12).max(1024) });
const limit = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });
const resetLimit = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });
const refreshLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const dummyHash = argon2.hash(randomUUID(), { type: argon2.argon2id });

function publicUser(user: { id: string; emailNormalized: string; displayName: string | null }) {
  return { id: user.id, email: user.emailNormalized, display_name: user.displayName };
}

export const authenticate: RequestHandler = async (request, response, next) => {
  try {
    const match = /^Bearer (\S+)$/i.exec(request.header('authorization') ?? '');
    if (!match) { response.status(401).json(generic); return; }
    const claims = await verifyAccessToken(match[1]!);
    const session = await getPrisma().authSession.findFirst({
      where: { id: claims.sessionId, userId: claims.userId, revokedAt: null,
        absoluteExpiresAt: { gt: new Date() }, user: { isActive: true } },
      include: { user: true },
    });
    if (!session) { response.status(401).json(generic); return; }
    response.locals.auth = { userId: claims.userId, sessionId: claims.sessionId, user: session.user };
    next();
  } catch { response.status(401).json(generic); }
};

router.post('/login', limit, async (request, response, next) => {
  try {
    const body = loginBody.parse(request.body);
    const db = getPrisma();
    const user = await db.appUser.findUnique({ where: { emailNormalized: body.email } });
    const validPassword = await argon2.verify(user?.passwordHash ?? await dummyHash, body.password);
    if (!user?.isActive || !validPassword) {
      response.status(401).json(generic); return;
    }
    const refreshToken = newRefreshToken();
    const sessionId = randomUUID();
    const accessToken = await signAccessToken(user.id, sessionId);
    await db.authSession.create({
      data: { id: sessionId, userId: user.id, absoluteExpiresAt: new Date(Date.now() + 30 * 86_400_000),
        refreshTokens: { create: { tokenHash: hashRefreshToken(refreshToken),
          expiresAt: new Date(Date.now() + 14 * 86_400_000) } } },
    });
    response.json({ access_token: accessToken, token_type: 'bearer',
      expires_in: accessTtlSeconds, refresh_token: refreshToken, user: publicUser(user) });
  } catch (error) { next(error); }
});

router.post('/refresh', refreshLimit, async (request, response, next) => {
  try {
    const body = refreshBody.parse(request.body);
    const db = getPrisma();
    const tokenHash = hashRefreshToken(body.refresh_token);
    const nextRefresh = newRefreshToken();
    const result = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM app.refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
      if (!rows.length) return { status: 'invalid' as const };
      const token = await tx.refreshToken.findUnique({ where: { id: rows[0]!.id },
        include: { session: { include: { user: true } } } });
      if (!token) return { status: 'invalid' as const };
      const session = token.session;
      await tx.$queryRaw`SELECT id FROM app.auth_sessions WHERE id = ${session.id}::uuid FOR UPDATE`;
      if (token.consumedAt || token.revokedAt) {
        await tx.authSession.update({ where: { id: session.id },
          data: { revokedAt: new Date(), revocationReason: 'refresh_reuse' } });
        return { status: 'invalid' as const };
      }
      if (!session.user.isActive || session.revokedAt || session.absoluteExpiresAt <= new Date() || token.expiresAt <= new Date()) {
        return { status: 'invalid' as const };
      }
      const replacement = await tx.refreshToken.create({ data: {
        sessionId: session.id, tokenHash: hashRefreshToken(nextRefresh),
        expiresAt: new Date(Math.min(session.absoluteExpiresAt.getTime(), Date.now() + 14 * 86_400_000)),
      } });
      await tx.refreshToken.update({ where: { id: token.id },
        data: { consumedAt: new Date(), replacedByTokenId: replacement.id } });
      await tx.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
      return { status: 'ok' as const, sessionId: session.id, user: session.user };
    });
    if (result.status !== 'ok') { response.status(401).json(generic); return; }
    response.json({ access_token: await signAccessToken(result.user.id, result.sessionId),
      token_type: 'bearer', expires_in: accessTtlSeconds, refresh_token: nextRefresh,
      user: publicUser(result.user) });
  } catch (error) { next(error); }
});

router.get('/me', authenticate, (_request, response) => response.json({ user: publicUser(response.locals.auth.user) }));
router.post('/logout', authenticate, async (_request, response, next) => {
  try {
    await getPrisma().authSession.update({ where: { id: response.locals.auth.sessionId },
      data: { revokedAt: new Date(), revocationReason: 'logout' } });
    response.status(204).end();
  } catch (error) { next(error); }
});
router.post('/change-password', authenticate, async (request, response, next) => {
  try {
    const body = passwordBody.parse(request.body);
    const { userId, sessionId, user } = response.locals.auth;
    if (!await argon2.verify(user.passwordHash, body.current_password)) {
      response.status(401).json(generic); return;
    }
    const hash = await argon2.hash(body.new_password, { type: argon2.argon2id });
    await getPrisma().$transaction(async (tx) => {
      await tx.appUser.update({ where: { id: userId },
        data: { passwordHash: hash, passwordChangedAt: new Date(),
          passwordResetHash: null, passwordResetExpiresAt: null } });
      await tx.authSession.updateMany({ where: { userId, id: { not: sessionId }, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'password_change' } });
    });
    response.status(204).end();
  } catch (error) { next(error); }
});

router.post('/reset-password', resetLimit, async (request, response, next) => {
  try {
    const body = resetBody.parse(request.body);
    const db = getPrisma();
    const user = await db.appUser.findUnique({ where: { emailNormalized: body.email } });
    if (!user?.isActive || !user.passwordResetHash || !user.passwordResetExpiresAt ||
        user.passwordResetExpiresAt <= new Date() ||
        user.passwordResetHash !== hashRecoveryCode(body.recovery_code)) {
      response.status(401).json(generic); return;
    }
    const hash = await argon2.hash(body.new_password, { type: argon2.argon2id });
    const changed = await db.$transaction(async (tx) => {
      const claimed = await tx.appUser.updateMany({
        where: { id: user.id, isActive: true, passwordResetHash: user.passwordResetHash,
          passwordResetExpiresAt: { gt: new Date() } },
        data: { passwordHash: hash, passwordChangedAt: new Date(),
          passwordResetHash: null, passwordResetExpiresAt: null },
      });
      if (claimed.count !== 1) return false;
      await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revocationReason: 'password_reset' } });
      return true;
    });
    if (!changed) { response.status(401).json(generic); return; }
    response.status(204).end();
  } catch (error) { next(error); }
});

export { router as authRouter };
