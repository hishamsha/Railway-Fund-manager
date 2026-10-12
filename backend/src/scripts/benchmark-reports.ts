import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.migrate', quiet: true });
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import request from 'supertest';
import { app } from '../app.js';
import { signAccessToken } from '../auth/crypto.js';
import { closePrisma } from '../database/prisma.js';

if (process.env.NODE_ENV === 'production') throw new Error('Benchmark must not run in production');
if (process.env.ALLOW_BENCHMARK_DEV_DB !== '1') {
  throw new Error('Set ALLOW_BENCHMARK_DEV_DB=1 only for an isolated development database');
}
if (!process.env.MIGRATION_DATABASE_URL || !process.env.DATABASE_URL) {
  throw new Error('Migration and runtime database URLs are required');
}
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
const owner = randomUUID();
const session = randomUUID();
const wallet = randomUUID();

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE app.customer_fund_entries DISABLE TRIGGER customer_fund_entries_immutable');
    await client.query('ALTER TABLE app.wallet_entries DISABLE TRIGGER wallet_entries_immutable');
    for (const table of ['audit_events', 'customer_fund_entries', 'wallet_entries', 'bookings',
      'packagers', 'wallets', 'operation_requests']) {
      await client.query(`DELETE FROM app.${table} WHERE owner_id = $1`, [owner]);
    }
    await client.query('DELETE FROM app.auth_sessions WHERE user_id = $1', [owner]);
    await client.query('DELETE FROM app.app_users WHERE id = $1', [owner]);
    await client.query('ALTER TABLE app.customer_fund_entries ENABLE TRIGGER customer_fund_entries_immutable');
    await client.query('ALTER TABLE app.wallet_entries ENABLE TRIGGER wallet_entries_immutable');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function main() {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO app.app_users
        (id, email_normalized, password_hash, updated_at)
        VALUES ($1, $2, 'benchmark-only', now())`, [owner, `${owner}@example.test`]);
      await client.query(`INSERT INTO app.auth_sessions (id, user_id, absolute_expires_at)
        VALUES ($1, $2, now() + interval '1 hour')`, [session, owner]);
      await client.query(`INSERT INTO app.packagers (id, owner_id, name, updated_at)
        SELECT gen_random_uuid(), $1, 'Benchmark ' || series.n, now()
        FROM generate_series(1, 100) AS series(n)`, [owner]);
      await client.query(`INSERT INTO app.bookings
        (id, owner_id, packager_id, boarding_station, destination_station,
          journey_date, train_identifier, ticket_price_paise, service_charge_paise, updated_at)
        SELECT gen_random_uuid(), $1, p.id, 'A', 'B', '2026-10-25',
          '12345', 10000, 1000, now()
        FROM app.packagers p CROSS JOIN generate_series(1, 10) AS series(n)
        WHERE p.owner_id = $1`, [owner]);
      await client.query(`INSERT INTO app.wallets
        (id, owner_id, name, opening_balance_paise, current_balance_paise, updated_at)
        VALUES ($1, $2, 'Benchmark wallet', 10000000, 5000000, now())`, [wallet, owner]);
      await client.query(`CREATE TEMP TABLE benchmark_keys
        (booking_id uuid PRIMARY KEY, request_id uuid NOT NULL) ON COMMIT PRESERVE ROWS`);
      await client.query(`INSERT INTO benchmark_keys
        SELECT id, gen_random_uuid() FROM app.bookings WHERE owner_id = $1`, [owner]);
      await client.query(`INSERT INTO app.operation_requests
        (owner_id, request_id, operation_type, payload_hash)
        SELECT $1, request_id, 'benchmark', repeat('a', 64) FROM benchmark_keys`, [owner]);
      await client.query(`INSERT INTO app.customer_fund_entries
        (id, owner_id, booking_id, entry_type, amount_paise, occurred_at, operation_request_id)
        SELECT gen_random_uuid(), $1, booking_id, 'receipt', 5000, now(), request_id
        FROM benchmark_keys`, [owner]);
      await client.query(`INSERT INTO app.wallet_entries
        (id, owner_id, wallet_id, booking_id, entry_type, amount_paise, occurred_at, operation_request_id)
        SELECT gen_random_uuid(), $1, $2, booking_id, 'booking_debit', 5000, now(), request_id
        FROM benchmark_keys`, [owner, wallet]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }

    const token = await signAccessToken(owner, session);
    const packager = await pool.query<{ id: string }>(
      'SELECT id FROM app.packagers WHERE owner_id = $1 LIMIT 1', [owner]);
    const paths = ['/api/v1/dashboard',
      `/api/v1/packagers/${packager.rows[0]!.id}/statement`,
      '/api/v1/reports/bookings?from_date=2026-10-25&to_date=2026-10-25&clock=journey_date'];
    for (const path of paths) {
      const durations: number[] = [];
      for (let index = 0; index < 20; index++) {
        const start = performance.now();
        const result = await request(app).get(path).set('Authorization', `Bearer ${token}`);
        if (result.status !== 200) throw new Error(`Benchmark request failed: ${result.status}`);
        durations.push(performance.now() - start);
      }
      durations.sort((a, b) => a - b);
      process.stdout.write(`${path}: p95=${durations[18]!.toFixed(1)}ms, max=${durations[19]!.toFixed(1)}ms\n`);
    }
  } finally {
    try { await cleanup(); } finally { await pool.end(); await closePrisma(); }
  }
}

await main();
