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
const password = 'agency-test-password';

async function cleanup(pool: Pool, owner: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE app.customer_fund_entries DISABLE TRIGGER customer_fund_entries_immutable');
    for (const table of ['journey_requests', 'audit_events', 'customer_fund_entries', 'booking_legs',
      'bookings', 'booking_accounts', 'service_charge_rules']) {
      await client.query(`DELETE FROM app.${table} WHERE owner_id = $1`, [owner]);
    }
    await client.query(`DELETE FROM app.refresh_tokens WHERE session_id IN (SELECT s.id FROM app.auth_sessions s
      JOIN app.app_users u ON u.id = s.user_id WHERE u.id = $1 OR u.agency_owner_id = $1)`, [owner]);
    await client.query(`DELETE FROM app.auth_sessions WHERE user_id IN (SELECT id FROM app.app_users
      WHERE id = $1 OR agency_owner_id = $1)`, [owner]);
    await client.query('DELETE FROM app.app_users WHERE agency_owner_id = $1', [owner]);
    await client.query('DELETE FROM app.packagers WHERE owner_id = $1', [owner]);
    await client.query('DELETE FROM app.operation_requests WHERE owner_id = $1', [owner]);
    await client.query('DELETE FROM app.app_users WHERE id = $1', [owner]);
    await client.query('ALTER TABLE app.customer_fund_entries ENABLE TRIGGER customer_fund_entries_immutable');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

describe.skipIf(!enabled)('Phase 2 agency portal and journey requests', () => {
  it('limits agencies to their own read-only data and runs the request flow', async () => {
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
      const admin = { Authorization: `Bearer ${await signAccessToken(owner, session)}` };
      const future = addDays(businessDate(), 10);

      const packager = async (name: string, extra: object = {}) => {
        const created = await request(app).post('/api/v1/packagers').set(admin).send({ name, ...extra });
        expect(created.status).toBe(201);
        return created.body.packager.id as string;
      };
      const agencyA = await packager('Agency A', { credit_limit_paise: 500_000, notes: 'INTERNAL-PACKAGER-NOTE' });
      const agencyB = await packager('Agency B');

      // The owner creates logins; the setup code is shown once and sets the password.
      const signUp = async (packagerId: string, label: string) => {
        const email = `${label}-${owner}@example.test`;
        const created = await request(app).post('/api/v1/agency-users').set(admin)
          .send({ packager_id: packagerId, email, display_name: label });
        expect(created.status).toBe(201);
        expect(created.body.agency_user).toMatchObject({ packager_id: packagerId, is_active: true, password_set: false });
        expect(JSON.stringify(created.body.agency_user)).not.toContain('hash');
        const reset = await request(app).post('/api/v1/auth/reset-password')
          .send({ email, recovery_code: created.body.setup_code, new_password: password });
        expect(reset.status).toBe(204);
        const login = await request(app).post('/api/v1/auth/login').send({ email, password });
        expect(login.status).toBe(200);
        expect(login.body.user).toMatchObject({ role: 'agency', packager_id: packagerId });
        return { id: created.body.agency_user.id as string, email,
          auth: { Authorization: `Bearer ${login.body.access_token}` } };
      };
      const userA = await signUp(agencyA, 'a');
      const userB = await signUp(agencyB, 'b');
      expect((await request(app).post('/api/v1/agency-users').set(admin)
        .send({ packager_id: agencyB, email: userA.email })).status).toBe(409);
      expect((await request(app).post('/api/v1/agency-users').set(admin)
        .send({ packager_id: randomUUID(), email: `x-${owner}@example.test` })).status).toBe(404);
      expect((await request(app).get(`/api/v1/agency-users?packager_id=${agencyA}`).set(admin)).body.items
        .map((user: { id: string }) => user.id)).toEqual([userA.id]);

      // An agency login is refused on every owner route, and the reverse.
      const ownerRoutes: Array<['get' | 'post' | 'patch' | 'put', string]> = [
        ['get', '/packagers'], ['post', '/packagers'], ['patch', `/packagers/${agencyA}`], ['get', `/packagers/${agencyA}`],
        ['get', `/packagers/${agencyA}/statement`], ['get', '/bookings'], ['post', '/bookings'], ['get', '/wallets'],
        ['post', '/wallets'], ['get', '/dashboard'], ['get', '/reports/bookings'], ['get', '/reports/collections'],
        ['get', '/reports/wallets'], ['get', '/booking-accounts'], ['post', '/booking-accounts'],
        ['get', '/service-charge-rules'], ['put', '/service-charge-rules'], ['get', '/tickets'],
        ['get', '/calendar?from_date=2026-11-01&to_date=2026-11-30'], ['get', '/agenda'],
        ['get', '/finance/pending-agencies'], ['post', `/finance/${randomUUID()}/reverse`],
        ['get', '/agency-users'], ['post', '/agency-users'], ['get', '/journey-requests'],
        ['post', `/journey-requests/${randomUUID()}/quote`],
      ];
      for (const [method, path] of ownerRoutes) {
        const refused = await request(app)[method](`/api/v1${path}`).set(userA.auth).send({});
        expect([path, refused.status]).toEqual([path, 403]);
      }
      expect((await request(app).get('/api/v1/portal/summary').set(admin)).status).toBe(403);
      expect((await request(app).get('/api/v1/portal/summary')).status).toBe(401);
      // Their own login still works.
      expect((await request(app).get('/api/v1/auth/me').set(userA.auth)).body.user.role).toBe('agency');

      // Owner data an agency must never see.
      const account = await request(app).post('/api/v1/booking-accounts').set(admin)
        .send({ name: 'SECRET-IRCTC-NAME', kind: 'personal_id', login_id: 'secret_login' });
      const bookFor = async (packagerId: string, extra: object = {}) => {
        const booking = await request(app).post('/api/v1/bookings').set(admin).set('Idempotency-Key', randomUUID())
          .send({ packager_id: packagerId, boarding_station: 'Kozhikode', destination_station: 'Chennai',
            journey_date: future, train_identifier: '12602', ticket_price_paise: 100_000, service_charge_paise: 5_000,
            booking_account_id: account.body.booking_account.id, pnr: '4512345678',
            wallet_deducted_paise: 90_000, notes: 'INTERNAL-BOOKING-NOTE', ...extra });
        expect(booking.status).toBe(201);
        return booking.body.booking.id as string;
      };
      const bookingA = await bookFor(agencyA);
      const bookingB = await bookFor(agencyB);
      expect((await request(app).post(`/api/v1/bookings/${bookingA}/collections`).set(admin)
        .set('Idempotency-Key', randomUUID()).send({ amount_paise: 25_000, method: 'upi',
          occurred_at: new Date().toISOString(), note: 'INTERNAL-PAYMENT-NOTE' })).status).toBe(201);

      const portal = (path: string, user = userA) => request(app).get(`/api/v1/portal${path}`).set(user.auth);
      const summary = await portal('/summary');
      expect(summary.status).toBe(200);
      expect(summary.body).toMatchObject({ agency: { id: agencyA, name: 'Agency A' }, booking_count: 1,
        total_payable_paise: 105_000, collected_paise: 25_000, net_due_paise: 80_000, overdue_paise: 0,
        credit_limit_paise: 500_000, available_credit_paise: 420_000, upcoming_ticket_count: 1 });
      const bookings = await portal('/bookings?scope=upcoming');
      expect(bookings.body.items.map((item: { id: string }) => item.id)).toEqual([bookingA]);
      expect(bookings.body.items[0]).toMatchObject({ total_payable_paise: 105_000, balance_due_paise: 80_000 });
      expect(bookings.body.items[0].legs[0]).toMatchObject({ pnr: '4512345678', ticket_status: 'booked' });
      expect((await portal('/bookings?scope=past')).body.items).toHaveLength(0);
      const journeys = await portal('/journeys');
      expect(journeys.body.items.map((item: { booking_id: string }) => item.booking_id)).toEqual([bookingA]);
      const payments = await portal('/payments');
      expect(payments.body.items).toHaveLength(1);
      expect(payments.body.items[0]).toMatchObject({ booking_id: bookingA, amount_paise: 25_000, method: 'upi' });
      const detail = await portal(`/bookings/${bookingA}`);
      expect(detail.status).toBe(200);

      // No response carries the owner's private fields or notes.
      for (const body of [summary.body, bookings.body, journeys.body, payments.body, detail.body]) {
        const text = JSON.stringify(body);
        for (const secret of ['INTERNAL-', 'SECRET-', 'secret_login', 'booking_account', 'wallet', 'fund_balance',
          account.body.booking_account.id as string]) {
          expect(text).not.toContain(secret);
        }
      }

      // Another agency's records look like they do not exist.
      expect((await portal(`/bookings/${bookingB}`)).status).toBe(404);
      expect((await portal(`/bookings/${bookingA}`, userB)).status).toBe(404);
      expect((await portal('/payments', userB)).body.items).toHaveLength(0);

      // Agencies can create a request but cannot choose whose it is.
      const journey = { boarding_station: 'Kozhikode', destination_station: 'Delhi', journey_date: future,
        train_identifier: '12431', passenger_count: 4, ticket_type: 'connected', note: 'Family of four' };
      const send = (body: object, key: string, user = userA) => request(app).post('/api/v1/portal/journey-requests')
        .set(user.auth).set('Idempotency-Key', key).send(body);
      const key = randomUUID();
      const created = await send(journey, key);
      expect(created.status).toBe(201);
      expect(created.body.journey_request).toMatchObject({ status: 'pending', passenger_count: 4, quote: null });
      const requestId = created.body.journey_request.id as string;
      const replay = await send(journey, key);
      expect(replay.status).toBe(200);
      expect(replay.body.journey_request.id).toBe(requestId);
      expect((await send({ ...journey, passenger_count: 5 }, key)).status).toBe(409);
      expect((await send({ ...journey, packager_id: agencyB }, randomUUID())).status).toBe(422);
      expect((await send({ ...journey, journey_date: addDays(businessDate(), -1) }, randomUUID())).status).toBe(422);
      expect((await request(app).post('/api/v1/portal/journey-requests').set(userA.auth).send(journey)).status).toBe(400);
      // The same key from another agency is a separate request.
      const otherAgency = await send(journey, key, userB);
      expect(otherAgency.status).toBe(201);
      expect(otherAgency.body.journey_request.id).not.toBe(requestId);

      const accept = (id: string, total: number, user = userA) => request(app)
        .post(`/api/v1/portal/journey-requests/${id}/accept`).set(user.auth).send({ quoted_total_paise: total });
      const quote = (id: string, body: object) => request(app).post(`/api/v1/journey-requests/${id}/quote`).set(admin).send(body);
      expect((await accept(requestId, 1)).body.error.code).toBe('REQUEST_STATE_CONFLICT');
      expect((await request(app).get(`/api/v1/portal/journey-requests/${requestId}`).set(userB.auth)).status).toBe(404);
      expect((await request(app).post(`/api/v1/portal/journey-requests/${requestId}/cancel`).set(userB.auth)).status).toBe(404);
      expect((await accept(requestId, 1, userB)).status).toBe(404);

      // The owner sees who asked, and quotes using the charge rule by default.
      const queue = await request(app).get('/api/v1/journey-requests?status=pending').set(admin);
      expect(queue.body.items).toHaveLength(2);
      expect(queue.body.items.find((item: { id: string }) => item.id === requestId)).toMatchObject({
        packager_id: agencyA, packager_name: 'Agency A', requested_by: { email: userA.email } });
      expect((await request(app).put('/api/v1/service-charge-rules').set(admin)
        .send({ packager_id: agencyA, ticket_type: 'connected', charge_paise: 8_000 })).status).toBe(201);
      const quoted = await quote(requestId, { ticket_price_paise: 200_000, note: 'Tatkal fare' });
      expect(quoted.status).toBe(200);
      expect(quoted.body.journey_request.quote).toMatchObject({ ticket_price_paise: 200_000,
        service_charge_paise: 8_000, total_paise: 208_000, note: 'Tatkal fare' });
      expect((await quote(requestId, { ticket_price_paise: 210_000, service_charge_paise: 0 })).body
        .journey_request.quote.total_paise).toBe(210_000);

      // Accepting needs the total currently on offer.
      const stale = await accept(requestId, 208_000);
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('QUOTE_CHANGED');
      const accepted = await accept(requestId, 210_000);
      expect(accepted.status).toBe(200);
      expect(accepted.body.journey_request.status).toBe('accepted');
      expect((await quote(requestId, { ticket_price_paise: 1 })).status).toBe(409);
      expect((await portal('/summary')).body.open_request_count).toBe(1);

      // Booking links the request; it cannot be booked for another agency or twice.
      expect((await request(app).post('/api/v1/bookings').set(admin).set('Idempotency-Key', randomUUID())
        .send({ packager_id: agencyB, boarding_station: 'Kozhikode', destination_station: 'Delhi', journey_date: future,
          train_identifier: '12431', ticket_price_paise: 200_000, journey_request_id: requestId })).status).toBe(404);
      expect((await request(app).get('/api/v1/bookings?packager_id=' + agencyB).set(admin)).body.items).toHaveLength(1);
      const bookingFromRequest = await bookFor(agencyA, { journey_request_id: requestId, notes: null });
      const booked = await portal(`/journey-requests/${requestId}`);
      expect(booked.body.journey_request).toMatchObject({ status: 'booked', booking_id: bookingFromRequest });
      expect((await request(app).post('/api/v1/bookings').set(admin).set('Idempotency-Key', randomUUID())
        .send({ packager_id: agencyA, boarding_station: 'Kozhikode', destination_station: 'Delhi', journey_date: future,
          train_identifier: '12431', ticket_price_paise: 200_000, journey_request_id: requestId })).body.error.code)
        .toBe('REQUEST_STATE_CONFLICT');
      expect((await request(app).post(`/api/v1/portal/journey-requests/${requestId}/cancel`).set(userA.auth)).status).toBe(409);

      // Decline and cancel are final.
      const otherId = otherAgency.body.journey_request.id as string;
      expect((await request(app).post(`/api/v1/journey-requests/${otherId}/decline`).set(admin).send({})).status).toBe(422);
      const declined = await request(app).post(`/api/v1/journey-requests/${otherId}/decline`).set(admin)
        .send({ reason: 'No seats' });
      expect(declined.body.journey_request).toMatchObject({ status: 'declined', decline_reason: 'No seats' });
      expect((await request(app).post(`/api/v1/portal/journey-requests/${otherId}/cancel`).set(userB.auth)).status).toBe(409);
      const toCancel = await send(journey, randomUUID());
      const cancelled = await request(app).post(`/api/v1/portal/journey-requests/${toCancel.body.journey_request.id}/cancel`)
        .set(userA.auth);
      expect(cancelled.body.journey_request.status).toBe('cancelled');

      // Archiving the agency closes its portal; deactivating a login ends it at once.
      expect((await request(app).patch(`/api/v1/packagers/${agencyB}`).set(admin).send({ is_archived: true })).status).toBe(200);
      expect((await portal('/summary', userB)).status).toBe(403);
      expect((await request(app).patch(`/api/v1/agency-users/${userA.id}`).set(admin).send({ is_active: false })).status).toBe(200);
      expect((await portal('/summary')).status).toBe(401);
      expect((await request(app).post(`/api/v1/agency-users/${userA.id}/setup-code`).set(admin)).status).toBe(409);
      expect((await request(app).patch(`/api/v1/agency-users/${randomUUID()}`).set(admin).send({ is_active: false })).status).toBe(404);
    } finally {
      await cleanup(pool, owner);
      await pool.end();
      await closePrisma();
      delete process.env.JWT_PRIVATE_KEY_PEM;
      delete process.env.JWT_PUBLIC_KEY_PEM;
    }
  }, 60000);
});
