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

describe.skipIf(!enabled)('M04 owner-scoped packager API', () => {
  it('creates, searches, paginates, archives and hides another owner’s records', async () => {
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
      expect((await request(app).get('/api/v1/packagers')).status).toBe(401);
      const created = [];
      for (const name of ['Alpha', 'Beta', 'Gamma']) {
        const result = await request(app).post('/api/v1/packagers')
          .set('Authorization', `Bearer ${accessA}`).send({ name });
        expect(result.status).toBe(201);
        created.push(result.body.packager.id as string);
      }
      const foreign = await request(app).post('/api/v1/packagers')
        .set('Authorization', `Bearer ${accessB}`).send({ name: 'Foreign' });
      expect(foreign.status).toBe(201);
      expect((await request(app).get(`/api/v1/packagers?cursor=${foreign.body.packager.id}`)
        .set('Authorization', `Bearer ${accessA}`)).status).toBe(404);
      const page1 = await request(app).get('/api/v1/packagers?limit=2')
        .set('Authorization', `Bearer ${accessA}`);
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.next_cursor).toBeTruthy();
      const page2 = await request(app).get(`/api/v1/packagers?limit=2&cursor=${page1.body.next_cursor}`)
        .set('Authorization', `Bearer ${accessA}`);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.next_cursor).toBeNull();
      const search = await request(app).get('/api/v1/packagers?search=alp')
        .set('Authorization', `Bearer ${accessA}`);
      expect(search.body.items.map((item: { name: string }) => item.name)).toEqual(['Alpha']);
      expect((await request(app).get(`/api/v1/packagers/${foreign.body.packager.id}`)
        .set('Authorization', `Bearer ${accessA}`)).status).toBe(404);
      expect((await request(app).patch(`/api/v1/packagers/${foreign.body.packager.id}`)
        .set('Authorization', `Bearer ${accessA}`).send({ name: 'Stolen' })).status).toBe(404);
      const archive = await request(app).patch(`/api/v1/packagers/${created[0]}`)
        .set('Authorization', `Bearer ${accessA}`).send({ is_archived: true });
      expect(archive.status).toBe(200);
      expect(archive.body.packager.is_archived).toBe(true);
      const active = await request(app).get('/api/v1/packagers').set('Authorization', `Bearer ${accessA}`);
      expect(active.body.items).toHaveLength(2);
    } finally {
      await pool.query('DELETE FROM app.packagers WHERE owner_id = ANY($1::uuid[])', [[ownerA, ownerB]]);
      await pool.query('DELETE FROM app.auth_sessions WHERE user_id = ANY($1::uuid[])', [[ownerA, ownerB]]);
      await pool.query('DELETE FROM app.app_users WHERE id = ANY($1::uuid[])', [[ownerA, ownerB]]);
      await pool.end();
      await closePrisma();
      delete process.env.JWT_PRIVATE_KEY_PEM;
      delete process.env.JWT_PUBLIC_KEY_PEM;
    }
  }, 30000);
});
