import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.migrate', quiet: true });
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { closePrisma } from '../../src/database/prisma.js';
import { signAccessToken } from '../../src/auth/crypto.js';

const enabled = Boolean(process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL);

async function cleanupTestWallets(pool: Pool, owners: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE app.wallet_entries DISABLE TRIGGER wallet_entries_immutable');
    await client.query('DELETE FROM app.audit_events WHERE owner_id = ANY($1::uuid[])', [owners]);
    await client.query('DELETE FROM app.wallet_entries WHERE owner_id = ANY($1::uuid[])', [owners]);
    await client.query('DELETE FROM app.wallets WHERE owner_id = ANY($1::uuid[])', [owners]);
    await client.query('DELETE FROM app.operation_requests WHERE owner_id = ANY($1::uuid[])', [owners]);
    await client.query('DELETE FROM app.auth_sessions WHERE user_id = ANY($1::uuid[])', [owners]);
    await client.query('DELETE FROM app.app_users WHERE id = ANY($1::uuid[])', [owners]);
    await client.query('ALTER TABLE app.wallet_entries ENABLE TRIGGER wallet_entries_immutable');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

describe.skipIf(!enabled)('M05 wallet baseline', () => {
  it('creates once, tops up once on retry, and keeps balances owner scoped', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    try {
      for (const [owner, session] of [[ownerA, sessionA], [ownerB, sessionB]]) {
        await pool.query('INSERT INTO app.app_users (id, email_normalized, password_hash, updated_at) VALUES ($1, $2, $3, now())',
          [owner, `${owner}@example.test`, 'test-only-hash']);
        await pool.query('INSERT INTO app.auth_sessions (id, user_id, absolute_expires_at) VALUES ($1, $2, now() + interval \'1 day\')',
          [session, owner]);
      }
      const accessA = await signAccessToken(ownerA, sessionA);
      const accessB = await signAccessToken(ownerB, sessionB);
      const createKey = randomUUID();
      const create = () => request(app).post('/api/v1/wallets')
        .set('Authorization', `Bearer ${accessA}`).set('Idempotency-Key', createKey)
        .send({ name: 'IRCTC wallet', opening_balance_paise: 2_000_000 });
      const first = await create();
      expect(first.status).toBe(201);
      expect(first.body.wallet.current_balance_paise).toBe(2_000_000);
      const replay = await create();
      expect(replay.status).toBe(200);
      expect(replay.body.wallet.id).toBe(first.body.wallet.id);
      const walletId = first.body.wallet.id as string;
      expect((await request(app).get(`/api/v1/wallets/${walletId}`).set('Authorization', `Bearer ${accessB}`)).status).toBe(404);
      const topupKey = randomUUID();
      const topupBody = { amount_paise: 50_000, occurred_at: '2026-10-11T10:00:00Z', note: 'Funded' };
      const topup = () => request(app).post(`/api/v1/wallets/${walletId}/top-ups`)
        .set('Authorization', `Bearer ${accessA}`).set('Idempotency-Key', topupKey).send(topupBody);
      const topupFirst = await topup();
      expect(topupFirst.status).toBe(201);
      expect(topupFirst.body.wallet.current_balance_paise).toBe(2_050_000);
      expect((await topup()).status).toBe(200);
      expect((await request(app).post(`/api/v1/wallets/${walletId}/top-ups`)
        .set('Authorization', `Bearer ${accessA}`).set('Idempotency-Key', topupKey)
        .send({ ...topupBody, amount_paise: 60_000 })).status).toBe(409);
      expect((await request(app).post(`/api/v1/wallets/${walletId}/top-ups`)
        .set('Authorization', `Bearer ${accessB}`).set('Idempotency-Key', randomUUID())
        .send(topupBody)).status).toBe(404);
      const concurrentKey = randomUUID();
      const concurrentTopup = () => request(app).post(`/api/v1/wallets/${walletId}/top-ups`)
        .set('Authorization', `Bearer ${accessA}`).set('Idempotency-Key', concurrentKey)
        .send({ amount_paise: 100, occurred_at: '2026-10-11T10:01:00Z' });
      const concurrent = await Promise.all([concurrentTopup(), concurrentTopup()]);
      expect(concurrent.map((response) => response.status).sort()).toEqual([200, 201]);
      const entries = await request(app).get(`/api/v1/wallets/${walletId}/entries`)
        .set('Authorization', `Bearer ${accessA}`);
      expect(entries.body.items).toHaveLength(2);
      expect(entries.body.items.map((entry: { amount_paise: number }) => entry.amount_paise).sort()).toEqual([100, 50_000]);
      const stored = await pool.query<{ current_balance_paise: string }>(
        'SELECT current_balance_paise FROM app.wallets WHERE id = $1', [walletId]);
      expect(Number(stored.rows[0]?.current_balance_paise)).toBe(2_050_100);
    } finally {
      const owners = [ownerA, ownerB];
      try {
        await cleanupTestWallets(pool, owners);
      } finally {
        await pool.end();
        await closePrisma();
        delete process.env.JWT_PRIVATE_KEY_PEM;
        delete process.env.JWT_PUBLIC_KEY_PEM;
      }
    }
  }, 30000);
});
