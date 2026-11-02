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

async function cleanup(pool: Pool, owners: string[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE app.customer_fund_entries DISABLE TRIGGER customer_fund_entries_immutable');
    for (const table of ['audit_events', 'customer_fund_entries', 'booking_deduction_entries',
      'booking_legs', 'bookings', 'service_charge_rules', 'booking_accounts', 'packagers', 'operation_requests']) {
      await client.query(`DELETE FROM app.${table} WHERE owner_id = ANY($1::uuid[])`, [owners]);
    }
    await client.query('DELETE FROM app.auth_sessions WHERE user_id = ANY($1::uuid[])', [owners]);
    await client.query('DELETE FROM app.app_users WHERE id = ANY($1::uuid[])', [owners]);
    await client.query('ALTER TABLE app.customer_fund_entries ENABLE TRIGGER customer_fund_entries_immutable');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

describe.skipIf(!enabled)('Phase 1 admin: accounts, charge rules, legs, credit and dues', () => {
  it('books connected tickets with rule charges, enforces credit and reports dues', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
    const owners = [randomUUID(), randomUUID()];
    try {
      const tokens: string[] = [];
      for (const owner of owners) {
        const session = randomUUID();
        await pool.query('INSERT INTO app.app_users (id, email_normalized, password_hash, updated_at) VALUES ($1, $2, $3, now())',
          [owner, `${owner}@example.test`, 'test-only-hash']);
        await pool.query('INSERT INTO app.auth_sessions (id, user_id, absolute_expires_at) VALUES ($1, $2, now() + interval \'1 day\')',
          [session, owner]);
        tokens.push(await signAccessToken(owner, session));
      }
      const auth = { Authorization: `Bearer ${tokens[0]}` };
      const foreignAuth = { Authorization: `Bearer ${tokens[1]}` };

      // Booking accounts are owner scoped and never take a password.
      const irctc = await request(app).post('/api/v1/booking-accounts').set(auth)
        .send({ name: 'Hisham IRCTC', kind: 'personal_id', login_id: 'hisham_irctc' });
      expect(irctc.status).toBe(201);
      const portal = await request(app).post('/api/v1/booking-accounts').set(auth)
        .send({ name: 'Agent portal', kind: 'agent_portal' });
      expect((await request(app).post('/api/v1/booking-accounts').set(auth)
        .send({ name: 'Bad', kind: 'personal_id', password: 'x' })).status).toBe(422);
      const foreignAccount = await request(app).post('/api/v1/booking-accounts').set(foreignAuth)
        .send({ name: 'Foreign', kind: 'personal_id' });
      expect((await request(app).get(`/api/v1/booking-accounts/${foreignAccount.body.booking_account.id}`)
        .set(auth)).status).toBe(404);
      expect((await request(app).get('/api/v1/booking-accounts').set(auth)).body.items).toHaveLength(2);

      // Packager with a ₹1,500 credit limit, default and per-packager charges.
      const agency = await request(app).post('/api/v1/packagers').set(auth)
        .send({ name: 'Malabar Tours', credit_limit_paise: 150_000 });
      expect(agency.status).toBe(201);
      expect(agency.body.packager.credit_limit_paise).toBe(150_000);
      const agencyId = agency.body.packager.id as string;
      expect((await request(app).put('/api/v1/service-charge-rules').set(auth)
        .send({ packager_id: null, ticket_type: 'direct', charge_paise: 5_000 })).status).toBe(201);
      expect((await request(app).put('/api/v1/service-charge-rules').set(auth)
        .send({ packager_id: null, ticket_type: 'connected', charge_paise: 9_000 })).status).toBe(201);
      const override = await request(app).put('/api/v1/service-charge-rules').set(auth)
        .send({ packager_id: agencyId, ticket_type: 'connected', charge_paise: 7_000 });
      expect(override.status).toBe(201);
      const updated = await request(app).put('/api/v1/service-charge-rules').set(auth)
        .send({ packager_id: agencyId, ticket_type: 'connected', charge_paise: 8_000 });
      expect(updated.status).toBe(200);
      expect(updated.body.rule.id).toBe(override.body.rule.id);
      expect((await request(app).get(`/api/v1/service-charge-rules/quote?packager_id=${agencyId}&ticket_type=connected`)
        .set(auth)).body).toMatchObject({ charge_paise: 8_000, source: 'packager' });
      expect((await request(app).get(`/api/v1/service-charge-rules/quote?packager_id=${agencyId}&ticket_type=direct`)
        .set(auth)).body).toMatchObject({ charge_paise: 5_000, source: 'default' });

      // Connected booking: route, price, type and charge derive from the legs.
      const connected = await request(app).post('/api/v1/bookings').set(auth)
        .set('Idempotency-Key', randomUUID()).send({ packager_id: agencyId,
          initial_collected_paise: 20_000, payment_due_date: '2026-11-05',
          legs: [
            { boarding_station: 'Kozhikode', destination_station: 'Ernakulam', journey_date: '2026-11-10',
              train_identifier: '16346', fare_paise: 30_000, booking_account_id: irctc.body.booking_account.id,
              pnr: '4512345678' },
            { boarding_station: 'Ernakulam', destination_station: 'Chennai', journey_date: '2026-11-10',
              train_identifier: '12624', fare_paise: 70_000, booking_account_id: portal.body.booking_account.id,
              ticket_status: 'waitlisted' },
          ] });
      expect(connected.status).toBe(201);
      expect(connected.body.booking).toMatchObject({ boarding_station: 'Kozhikode', destination_station: 'Chennai',
        journey_date: '2026-11-10', train_identifier: '16346 / 12624', ticket_type: 'connected',
        payment_due_date: '2026-11-05' });
      expect(connected.body.booking.legs.map((leg: { ticket_status: string }) => leg.ticket_status))
        .toEqual(['booked', 'waitlisted']);
      expect(connected.body.financials).toMatchObject({ ticket_price_paise: 100_000,
        service_charge_paise: 8_000, total_payable_paise: 108_000, balance_due_paise: 88_000 });
      const bookingId = connected.body.booking.id as string;
      const legs = connected.body.booking.legs as Array<{ id: string }>;

      // Route fields and legs cannot be mixed; a foreign account is rejected.
      expect((await request(app).post('/api/v1/bookings').set(auth).set('Idempotency-Key', randomUUID())
        .send({ packager_id: agencyId, boarding_station: 'A', legs: [] })).status).toBe(422);
      expect((await request(app).post('/api/v1/bookings').set(auth).set('Idempotency-Key', randomUUID())
        .send({ packager_id: agencyId, boarding_station: 'Kozhikode', destination_station: 'Kannur',
          journey_date: '2026-11-12', train_identifier: '16603', ticket_price_paise: 1_000,
          booking_account_id: foreignAccount.body.booking_account.id })).status).toBe(404);

      // Due is ₹880; a direct ₹600 + ₹50 charge would reach ₹1,530 > ₹1,500.
      const directBody = { packager_id: agencyId, boarding_station: 'Kozhikode', destination_station: 'Kannur',
        journey_date: '2026-11-12', train_identifier: '16603', ticket_price_paise: 60_000 };
      const blocked = await request(app).post('/api/v1/bookings').set(auth)
        .set('Idempotency-Key', randomUUID()).send(directBody);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
      const allowed = await request(app).post('/api/v1/bookings').set(auth)
        .set('Idempotency-Key', randomUUID()).send({ ...directBody, allow_over_credit_limit: true });
      expect(allowed.status).toBe(201);
      expect(allowed.body.booking.ticket_type).toBe('direct');
      expect(allowed.body.booking.legs).toHaveLength(1);
      expect(allowed.body.financials.service_charge_paise).toBe(5_000);

      // Tracking a leg changes status and PNR without touching money.
      const tracked = await request(app).patch(`/api/v1/bookings/${bookingId}/legs/${legs[1]!.id}`).set(auth)
        .send({ ticket_status: 'confirmed', pnr: '4598765432' });
      expect(tracked.status).toBe(200);
      expect(tracked.body.leg).toMatchObject({ ticket_status: 'confirmed', pnr: '4598765432' });
      expect((await request(app).patch(`/api/v1/bookings/${bookingId}/legs/${legs[1]!.id}`).set(foreignAuth)
        .send({ ticket_status: 'cancelled' })).status).toBe(404);

      // A connected booking's route only changes through its legs.
      const current = await request(app).get(`/api/v1/bookings/${bookingId}`).set(auth);
      const editBase = { packager_id: agencyId, service_charge_paise: 8_000,
        collected_paise: 20_000, wallet_deducted_paise: 0, notes: null,
        expected_updated_at: current.body.booking.updated_at,
        expected_collected_paise: 20_000, expected_wallet_deducted_paise: 0, correction_reason: null };
      const routeEdit = await request(app).patch(`/api/v1/bookings/${bookingId}`).set(auth)
        .set('Idempotency-Key', randomUUID()).send({ ...editBase, boarding_station: 'Kozhikode',
          destination_station: 'Madurai', journey_date: '2026-11-10', train_identifier: '16346 / 12624',
          ticket_price_paise: 100_000 });
      expect(routeEdit.status).toBe(409);
      expect(routeEdit.body.error.code).toBe('LEGS_REQUIRED');
      const legEdit = await request(app).patch(`/api/v1/bookings/${bookingId}`).set(auth)
        .set('Idempotency-Key', randomUUID()).send({ ...editBase, legs: [
          { boarding_station: 'Kozhikode', destination_station: 'Ernakulam', journey_date: '2026-11-10',
            train_identifier: '16346', fare_paise: 35_000, booking_account_id: irctc.body.booking_account.id },
          { boarding_station: 'Ernakulam', destination_station: 'Chennai', journey_date: '2026-11-11',
            train_identifier: '12624', fare_paise: 70_000, ticket_status: 'confirmed' },
        ] });
      expect(legEdit.status).toBe(200);
      expect(legEdit.body.financials.ticket_price_paise).toBe(105_000);

      // Single-leg edits keep the leg id.
      const direct = await request(app).get(`/api/v1/bookings/${allowed.body.booking.id}`).set(auth);
      const directEdit = await request(app).patch(`/api/v1/bookings/${allowed.body.booking.id}`).set(auth)
        .set('Idempotency-Key', randomUUID()).send({ ...editBase, ...directBody, train_identifier: '16605',
          service_charge_paise: 5_000, collected_paise: 0, expected_collected_paise: 0,
          expected_updated_at: direct.body.booking.updated_at });
      expect(directEdit.status).toBe(200);
      expect(directEdit.body.booking.legs[0]).toMatchObject({ id: direct.body.booking.legs[0].id,
        train_identifier: '16605' });

      // Tracker, calendar, account usage, agenda and pending agencies.
      const waiting = await request(app).get('/api/v1/tickets?status=confirmed').set(auth);
      expect(waiting.body.items).toHaveLength(1);
      expect(waiting.body.items[0]).toMatchObject({ packager_name: 'Malabar Tours', journey_date: '2026-11-11' });
      expect((await request(app).get('/api/v1/tickets').set(foreignAuth)).body.items).toHaveLength(0);
      const calendar = await request(app).get('/api/v1/calendar?from_date=2026-11-01&to_date=2026-11-30').set(auth);
      expect(calendar.body.days.map((day: { date: string; total: number }) => [day.date, day.total]))
        .toEqual([['2026-11-10', 1], ['2026-11-11', 1], ['2026-11-12', 1]]);
      const usage = await request(app).get(`/api/v1/booking-accounts/${irctc.body.booking_account.id}/usage`).set(auth);
      expect(usage.body.usage).toMatchObject({ ticket_count: 1, fare_total_paise: 35_000 });
      const agenda = await request(app).get('/api/v1/agenda?date=2026-11-10').set(auth);
      expect(agenda.status).toBe(200);
      expect(agenda.body.today_journeys).toHaveLength(1);
      expect(agenda.body.tomorrow_journeys).toHaveLength(1);
      expect(agenda.body.overdue_payments.items.map((item: { booking_id: string }) => item.booking_id))
        .toEqual([bookingId]);
      expect(agenda.body.overdue_payments.total_due_paise).toBe(93_000);
      const pending = await request(app).get('/api/v1/finance/pending-agencies?date=2026-11-10').set(auth);
      expect(pending.body.items).toHaveLength(1);
      expect(pending.body.items[0]).toMatchObject({ name: 'Malabar Tours', booking_count: 2,
        net_due_paise: 158_000, overdue_paise: 93_000, oldest_due_date: '2026-11-05',
        credit_limit_paise: 150_000, available_credit_paise: -8_000, over_limit: true });
      expect((await request(app).get('/api/v1/finance/pending-agencies').set(foreignAuth)).body.items).toHaveLength(0);

      // Removing the override falls back to the default rule.
      expect((await request(app).delete(`/api/v1/service-charge-rules/${override.body.rule.id}`).set(auth)).status)
        .toBe(204);
      expect((await request(app).get(`/api/v1/service-charge-rules/quote?packager_id=${agencyId}&ticket_type=connected`)
        .set(auth)).body).toMatchObject({ charge_paise: 9_000, source: 'default' });
    } finally {
      await cleanup(pool, owners);
      await pool.end();
      await closePrisma();
      delete process.env.JWT_PRIVATE_KEY_PEM;
      delete process.env.JWT_PUBLIC_KEY_PEM;
    }
  }, 60000);
});
