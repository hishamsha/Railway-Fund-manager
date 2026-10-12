import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.migrate', quiet: true });
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { hashRecoveryCode } from '../../src/auth/recovery.js';
import { closePrisma } from '../../src/database/prisma.js';

const enabled = Boolean(process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL);

describe.skipIf(!enabled)('owner password recovery', () => {
  it('rejects expired codes, consumes a valid code once and revokes existing sessions', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
    const userId = randomUUID();
    const email = `${userId}@example.test`;
    const code = 'temporary-code-123';
    try {
      await pool.query(
        'INSERT INTO app.app_users (id, email_normalized, password_hash, updated_at) VALUES ($1, $2, $3, now())',
        [userId, email, await argon2.hash('original-password-123', { type: argon2.argon2id })],
      );
      const login = await request(app).post('/api/v1/auth/login')
        .send({ email, password: 'original-password-123' });
      expect(login.status).toBe(200);
      await pool.query(
        'UPDATE app.app_users SET password_reset_hash = $2, password_reset_expires_at = now() - interval \'1 minute\' WHERE id = $1',
        [userId, hashRecoveryCode(code)],
      );
      const body = { email, recovery_code: code, new_password: 'replacement-password-456' };
      expect((await request(app).post('/api/v1/auth/reset-password').send(body)).status).toBe(401);
      await pool.query(
        'UPDATE app.app_users SET password_reset_expires_at = now() + interval \'15 minutes\' WHERE id = $1',
        [userId],
      );
      expect((await request(app).post('/api/v1/auth/reset-password')
        .send({ ...body, recovery_code: 'incorrect-code-123' })).status).toBe(401);
      expect((await request(app).post('/api/v1/auth/reset-password').send(body)).status).toBe(204);
      expect((await request(app).post('/api/v1/auth/reset-password').send(body)).status).toBe(401);
      expect((await request(app).get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.access_token}`)).status).toBe(401);
      expect((await request(app).post('/api/v1/auth/refresh')
        .send({ refresh_token: login.body.refresh_token })).status).toBe(401);
      expect((await request(app).post('/api/v1/auth/login')
        .send({ email, password: 'original-password-123' })).status).toBe(401);
      expect((await request(app).post('/api/v1/auth/login')
        .send({ email, password: body.new_password })).status).toBe(200);
      const row = await pool.query<{ password_reset_hash: string | null }>(
        'SELECT password_reset_hash FROM app.app_users WHERE id = $1', [userId],
      );
      expect(row.rows[0]!.password_reset_hash).toBeNull();
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
