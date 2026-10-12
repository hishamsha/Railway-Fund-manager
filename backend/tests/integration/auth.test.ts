import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.migrate', quiet: true });
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { Pool } from 'pg';
import { decodeJwt, importPKCS8, SignJWT } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { closePrisma } from '../../src/database/prisma.js';

const enabled = Boolean(process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL);

describe.skipIf(!enabled)('M02 auth against isolated development DB', () => {
  it('rejects bad credentials, rotates once, detects reuse and revokes sessions', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
    const userId = randomUUID();
    const email = `${userId}@example.test`;
    try {
      expect((await request(app).get('/ready')).status).toBe(200);
      await pool.query(
        'INSERT INTO app.app_users (id, email_normalized, password_hash, updated_at) VALUES ($1, $2, $3, now())',
        [userId, email, await argon2.hash('correct-password-123', { type: argon2.argon2id })],
      );
      expect((await request(app).post('/api/v1/auth/login').send({ email, password: 'wrong' })).status).toBe(401);
      const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'correct-password-123' });
      expect(login.status).toBe(200);
      expect(login.body.user.id).toBe(userId);
      const access = login.body.access_token as string;
      const sessionId = decodeJwt(access).sid as string;
      const firstRefresh = login.body.refresh_token as string;
      expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`)).status).toBe(200);
      const expired = await new SignJWT({ sid: sessionId, typ: 'access' })
        .setProtectedHeader({ alg: 'RS256', kid: 'development-1' })
        .setIssuer('train-fund-manager-api').setAudience('train-fund-manager-mobile')
        .setSubject(userId).setJti(randomUUID()).setIssuedAt(Date.now() / 1000 - 3600)
        .setNotBefore('0s').setExpirationTime(Math.floor(Date.now() / 1000) - 1)
        .sign(await importPKCS8(process.env.JWT_PRIVATE_KEY_PEM!, 'RS256'));
      expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`)).status).toBe(401);
      expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${access}tampered`)).status).toBe(401);
      const wrongAudience = await new SignJWT({ sid: randomUUID(), typ: 'access' })
        .setProtectedHeader({ alg: 'RS256', kid: 'development-1' })
        .setIssuer('train-fund-manager-api').setAudience('wrong-audience')
        .setSubject(userId).setJti(randomUUID()).setIssuedAt().setNotBefore('0s')
        .setExpirationTime('10m')
        .sign(await importPKCS8(process.env.JWT_PRIVATE_KEY_PEM!, 'RS256'));
      expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${wrongAudience}`)).status).toBe(401);
      const rotate = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: firstRefresh });
      expect(rotate.status).toBe(200);
      expect(rotate.body.refresh_token).not.toBe(firstRefresh);
      const replay = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: firstRefresh });
      expect(replay.status).toBe(401);
      expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`)).status).toBe(401);
      expect((await request(app).post('/api/v1/auth/refresh').send({ refresh_token: rotate.body.refresh_token })).status).toBe(401);
      const login2 = await request(app).post('/api/v1/auth/login').send({ email, password: 'correct-password-123' });
      expect(login2.status).toBe(200);
      expect((await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${login2.body.access_token}`)).status).toBe(204);
      expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${login2.body.access_token}`)).status).toBe(401);
      const login3 = await request(app).post('/api/v1/auth/login').send({ email, password: 'correct-password-123' });
      expect(login3.status).toBe(200);
      const otherSession = await request(app).post('/api/v1/auth/login').send({ email, password: 'correct-password-123' });
      expect(otherSession.status).toBe(200);
      expect((await request(app).post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${login3.body.access_token}`)
        .send({ current_password: 'wrong', new_password: 'new-password-456' })).status).toBe(401);
      expect((await request(app).post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${login3.body.access_token}`)
        .send({ current_password: 'correct-password-123', new_password: 'new-password-456' })).status).toBe(204);
      expect((await request(app).get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${otherSession.body.access_token}`)).status).toBe(401);
      const changed = await pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM app.app_users WHERE id = $1', [userId],
      );
      expect(await argon2.verify(changed.rows[0]!.password_hash, 'new-password-456')).toBe(true);
      expect(await argon2.verify(changed.rows[0]!.password_hash, 'correct-password-123')).toBe(false);
      const concurrent = await Promise.all([
        request(app).post('/api/v1/auth/refresh').send({ refresh_token: login3.body.refresh_token }),
        request(app).post('/api/v1/auth/refresh').send({ refresh_token: login3.body.refresh_token }),
      ]);
      expect(concurrent.map((result) => result.status).sort()).toEqual([200, 401]);
      expect((await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${login3.body.access_token}`)).status).toBe(401);
    } finally {
      await pool.query('DELETE FROM app.refresh_tokens WHERE session_id IN (SELECT id FROM app.auth_sessions WHERE user_id = $1)', [userId]);
      await pool.query('DELETE FROM app.auth_sessions WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM app.app_users WHERE id = $1', [userId]);
      await pool.end();
      await closePrisma();
      delete process.env.JWT_PRIVATE_KEY_PEM;
      delete process.env.JWT_PUBLIC_KEY_PEM;
    }
  }, 30000);
});
