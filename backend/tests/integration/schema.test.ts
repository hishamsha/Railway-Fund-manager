import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.migrate', quiet: true });
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const databaseUrl = process.env.MIGRATION_DATABASE_URL;

describe.skipIf(!databaseUrl)('M01 database constraints (isolated development DB)', () => {
  it('keeps bookings owner scoped and finance entries immutable', async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000 });
    const client = await pool.connect();
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const packagerA = randomUUID();
    const bookingA = randomUUID();
    const operationA = randomUUID();
    const receiptA = randomUUID();

    try {
      await client.query('BEGIN');
      for (const ownerId of [ownerA, ownerB]) {
        await client.query(
          'INSERT INTO app.app_users (id, email_normalized, password_hash, updated_at) VALUES ($1, $2, $3, now())',
          [ownerId, `${ownerId}@example.test`, 'test-only-hash'],
        );
      }
      await client.query(
        'INSERT INTO app.packagers (id, owner_id, name, updated_at) VALUES ($1, $2, $3, now())',
        [packagerA, ownerA, 'Test Packager'],
      );

      await client.query('SAVEPOINT wrong_owner');
      await expect(client.query(
        `INSERT INTO app.bookings
          (id, owner_id, packager_id, boarding_station, destination_station, journey_date,
           train_identifier, ticket_price_paise, service_charge_paise, updated_at)
         VALUES ($1, $2, $3, 'Kozhikode', 'Chennai', '2026-10-25', '12626', 1000000, 100000, now())`,
        [randomUUID(), ownerB, packagerA],
      )).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT wrong_owner');

      await client.query(
        `INSERT INTO app.bookings
          (id, owner_id, packager_id, boarding_station, destination_station, journey_date,
           train_identifier, ticket_price_paise, service_charge_paise, updated_at)
         VALUES ($1, $2, $3, 'Kozhikode', 'Chennai', '2026-10-25', '12626', 1000000, 100000, now())`,
        [bookingA, ownerA, packagerA],
      );
      await client.query(
        'INSERT INTO app.operation_requests (owner_id, request_id, operation_type, payload_hash) VALUES ($1, $2, $3, $4)',
        [ownerA, operationA, 'create_booking', 'a'.repeat(64)],
      );
      await client.query(
        `INSERT INTO app.customer_fund_entries
          (id, owner_id, booking_id, entry_type, amount_paise, occurred_at, operation_request_id)
         VALUES ($1, $2, $3, 'receipt', 850000, now(), $4)`,
        [receiptA, ownerA, bookingA, operationA],
      );
      await client.query('SAVEPOINT immutable_receipt');
      await expect(client.query(
        'UPDATE app.customer_fund_entries SET amount_paise = 1 WHERE id = $1',
        [receiptA],
      )).rejects.toMatchObject({ message: expect.stringContaining('immutable') });
      await client.query('ROLLBACK TO SAVEPOINT immutable_receipt');

      await client.query('SAVEPOINT invalid_money');
      await expect(client.query(
        `INSERT INTO app.customer_fund_entries
          (id, owner_id, booking_id, entry_type, amount_paise, occurred_at, operation_request_id)
         VALUES ($1, $2, $3, 'receipt', -1, now(), $4)`,
        [randomUUID(), ownerA, bookingA, operationA],
      )).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_money');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  }, 30000);
});
