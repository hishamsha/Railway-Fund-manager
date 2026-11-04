import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.migrate', quiet: true });
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/app.js';
import { addDays, businessDate } from '../../src/admin/rules.js';
import { closePrisma } from '../../src/database/prisma.js';
import { signAccessToken } from '../../src/auth/crypto.js';

const enabled = Boolean(process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL);

async function cleanup(pool: Pool, owner: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE app.customer_fund_entries DISABLE TRIGGER customer_fund_entries_immutable');
    for (const table of ['audit_events', 'customer_fund_entries', 'booking_legs', 'bookings', 'service_charge_rules',
      'packagers', 'operation_requests']) {
      await client.query(`DELETE FROM app.${table} WHERE owner_id = $1`, [owner]);
    }
    await client.query('DELETE FROM app.auth_sessions WHERE user_id = $1', [owner]);
    await client.query('DELETE FROM app.app_users WHERE id = $1', [owner]);
    await client.query('ALTER TABLE app.customer_fund_entries ENABLE TRIGGER customer_fund_entries_immutable');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

describe.skipIf(!enabled)('Cancelled tickets and cancellation charges', () => {
  it('bills only active fares and charges, everywhere dues are reported', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
    const owner = randomUUID();
    const session = randomUUID();
    try {
      await pool.query('INSERT INTO app.app_users (id, email_normalized, password_hash, updated_at) VALUES ($1, $2, $3, now())',
        [owner, `${owner}@example.test`, 'test-only-hash']);
      await pool.query('INSERT INTO app.auth_sessions (id, user_id, absolute_expires_at) VALUES ($1, $2, now() + interval \'1 day\')',
        [session, owner]);
      const auth = { Authorization: `Bearer ${await signAccessToken(owner, session)}` };
      const date = addDays(businessDate(), 3);
      const agency = (await request(app).post('/api/v1/packagers').set(auth).send({ name: 'Cancel Tours' })).body.packager.id as string;
      const leg = (from: string, to: string, fare: number, extra: object = {}) => ({ boarding_station: from,
        destination_station: to, journey_date: date, train_identifier: '12601', fare_paise: fare, ...extra });
      const create = (body: object) => request(app).post('/api/v1/bookings').set(auth)
        .set('Idempotency-Key', randomUUID()).send({ packager_id: agency, service_charge_paise: 5_000, ...body });
      const moneyOf = async (id: string) => (await request(app).get(`/api/v1/bookings/${id}`).set(auth)).body.financials;

      const connected = await create({ initial_collected_paise: 30_000,
        legs: [leg('A', 'B', 40_000), leg('B', 'C', 60_000)] });
      expect(connected.status).toBe(201);
      expect(connected.body.financials).toMatchObject({ ticket_price_paise: 100_000, balance_due_paise: 75_000 });
      const id = connected.body.booking.id as string;
      const [first, second] = connected.body.booking.legs as Array<{ id: string }>;
      const track = (legId: string, body: object) =>
        request(app).patch(`/api/v1/bookings/${id}/legs/${legId}`).set(auth).send(body);

      // A charge needs a cancelled ticket.
      const refused = await track(first!.id, { cancellation_charge_paise: 1_000 });
      expect(refused.status).toBe(422);
      expect(refused.body.error.code).toBe('CHARGE_NEEDS_CANCELLED');
      expect((await moneyOf(id)).ticket_price_paise).toBe(100_000);

      // Cancelling removes the fare at once, then a charge is added back.
      const cancelled = await track(second!.id, { ticket_status: 'cancelled' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.financials).toMatchObject({ ticket_price_paise: 40_000, total_payable_paise: 45_000, balance_due_paise: 15_000 });
      const charged = await track(second!.id, { cancellation_charge_paise: 7_500 });
      expect(charged.body.leg).toMatchObject({ ticket_status: 'cancelled', cancellation_charge_paise: 7_500, fare_paise: 60_000 });
      expect(charged.body.financials).toMatchObject({ ticket_price_paise: 47_500, balance_due_paise: 22_500 });

      // Dues reports use the billed amount.
      const pending = await request(app).get('/api/v1/finance/pending-agencies').set(auth);
      expect(pending.body.items[0]).toMatchObject({ net_due_paise: 22_500 });
      const statement = await request(app).get(`/api/v1/packagers/${agency}/statement`).set(auth);
      expect(statement.body.summary).toMatchObject({ total_payable_paise: 52_500, net_due_paise: 22_500 });
      const dashboard = await request(app).get('/api/v1/dashboard').set(auth);
      expect(dashboard.body.balance_due_paise).toBe(22_500);

      // Only the status change touches money; a PNR edit leaves the price alone.
      expect((await track(second!.id, { pnr: '4512345678' })).body.financials.ticket_price_paise).toBe(47_500);

      // Restoring the ticket clears the charge and bills the fare again.
      const restored = await track(second!.id, { ticket_status: 'booked' });
      expect(restored.body.leg.cancellation_charge_paise).toBe(0);
      expect(restored.body.financials.ticket_price_paise).toBe(100_000);

      // Editing with legs follows the same rule, and rejects a charge on an active ticket.
      const current = await request(app).get(`/api/v1/bookings/${id}`).set(auth);
      const editBase = { packager_id: agency, service_charge_paise: 5_000, collected_paise: 30_000, wallet_deducted_paise: 0,
        notes: null, expected_updated_at: current.body.booking.updated_at, expected_collected_paise: 30_000,
        expected_wallet_deducted_paise: 0, correction_reason: null };
      const edit = (body: object) => request(app).patch(`/api/v1/bookings/${id}`).set(auth).set('Idempotency-Key', randomUUID()).send(body);
      expect((await edit({ ...editBase, legs: [leg('A', 'B', 40_000, { cancellation_charge_paise: 100 }), leg('B', 'C', 60_000)] })).status).toBe(422);
      const edited = await edit({ ...editBase, legs: [leg('A', 'B', 40_000),
        leg('B', 'C', 60_000, { ticket_status: 'cancelled', cancellation_charge_paise: 2_000 })] });
      expect(edited.status).toBe(200);
      expect(edited.body.financials.ticket_price_paise).toBe(42_000);

      // A fully cancelled booking with no charges bills only its service charge,
      // and money already paid shows as credit to refund.
      const legs = edited.body.booking.legs as Array<{ id: string }>;
      await track(legs[0]!.id, { ticket_status: 'cancelled' });
      const zero = await track(legs[1]!.id, { cancellation_charge_paise: 0 });
      expect(zero.body.financials).toMatchObject({ ticket_price_paise: 0, total_payable_paise: 5_000,
        collected_paise: 30_000, balance_due_paise: 0, advance_credit_paise: 25_000 });

      // An older client editing a cancelled direct ticket keeps its fare and charge.
      const direct = await create({ boarding_station: 'X', destination_station: 'Y', journey_date: date,
        train_identifier: '16603', ticket_price_paise: 50_000 });
      const directId = direct.body.booking.id as string;
      const directLeg = direct.body.booking.legs[0].id as string;
      await request(app).patch(`/api/v1/bookings/${directId}/legs/${directLeg}`).set(auth)
        .send({ ticket_status: 'cancelled', cancellation_charge_paise: 3_000 });
      const before = await request(app).get(`/api/v1/bookings/${directId}`).set(auth);
      const route = { boarding_station: 'X', destination_station: 'Y', journey_date: date, train_identifier: '16604' };
      const oldEdit = { ...editBase, ...route, collected_paise: 0, expected_collected_paise: 0,
        expected_updated_at: before.body.booking.updated_at };
      const editDirect = (body: object) => request(app).patch(`/api/v1/bookings/${directId}`).set(auth).set('Idempotency-Key', randomUUID()).send(body);
      expect((await editDirect({ ...oldEdit, ticket_price_paise: 9_000 })).body.error.code).toBe('LEGS_REQUIRED');
      const kept = await editDirect({ ...oldEdit, ticket_price_paise: 3_000 });
      expect(kept.status).toBe(200);
      expect(kept.body.booking.legs[0]).toMatchObject({ train_identifier: '16604', fare_paise: 50_000,
        cancellation_charge_paise: 3_000, ticket_status: 'cancelled' });
      expect(kept.body.financials.ticket_price_paise).toBe(3_000);

      // An active direct ticket still cannot be priced at zero.
      const active = await create({ boarding_station: 'P', destination_station: 'Q', journey_date: date,
        train_identifier: '16605', ticket_price_paise: 1_000 });
      const zeroEdit = await request(app).patch(`/api/v1/bookings/${active.body.booking.id}`).set(auth).set('Idempotency-Key', randomUUID())
        .send({ ...editBase, boarding_station: 'P', destination_station: 'Q', journey_date: date, train_identifier: '16605',
          ticket_price_paise: 0, collected_paise: 0, expected_collected_paise: 0, expected_updated_at: active.body.booking.updated_at });
      expect(zeroEdit.status).toBe(422);
    } finally {
      await cleanup(pool, owner);
      await pool.end();
      await closePrisma();
      delete process.env.JWT_PRIVATE_KEY_PEM;
      delete process.env.JWT_PUBLIC_KEY_PEM;
    }
  }, 60000);
});
