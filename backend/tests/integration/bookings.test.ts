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
    await client.query('ALTER TABLE app.booking_deduction_entries DISABLE TRIGGER booking_deduction_entries_immutable');
    await client.query('ALTER TABLE app.wallet_entries DISABLE TRIGGER wallet_entries_immutable');
    for (const table of ['audit_events', 'customer_fund_entries', 'booking_deduction_entries', 'wallet_entries', 'bookings',
      'packagers', 'wallets', 'operation_requests']) {
      await client.query(`DELETE FROM app.${table} WHERE owner_id = ANY($1::uuid[])`, [owners]);
    }
    await client.query('DELETE FROM app.auth_sessions WHERE user_id = ANY($1::uuid[])', [owners]);
    await client.query('DELETE FROM app.app_users WHERE id = ANY($1::uuid[])', [owners]);
    await client.query('ALTER TABLE app.customer_fund_entries ENABLE TRIGGER customer_fund_entries_immutable');
    await client.query('ALTER TABLE app.booking_deduction_entries ENABLE TRIGGER booking_deduction_entries_immutable');
    await client.query('ALTER TABLE app.wallet_entries ENABLE TRIGGER wallet_entries_immutable');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

describe.skipIf(!enabled)('M06â€“M07 booking funds', () => {
  it('keeps due separate from wallet, collects partially, displays credit, and deduplicates retries', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.JWT_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    process.env.JWT_PUBLIC_KEY_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, max: 1 });
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const owners = [ownerA, ownerB];
    try {
      const sessions = [randomUUID(), randomUUID()];
      for (const [index, owner] of owners.entries()) {
        await pool.query('INSERT INTO app.app_users (id, email_normalized, password_hash, updated_at) VALUES ($1, $2, $3, now())',
          [owner, `${owner}@example.test`, 'test-only-hash']);
        await pool.query('INSERT INTO app.auth_sessions (id, user_id, absolute_expires_at) VALUES ($1, $2, now() + interval \'1 day\')',
          [sessions[index], owner]);
      }
      const tokenA = await signAccessToken(ownerA, sessions[0]!);
      const tokenB = await signAccessToken(ownerB, sessions[1]!);
      const packagerA = await request(app).post('/api/v1/packagers')
        .set('Authorization', `Bearer ${tokenA}`).send({ name: 'ABC Travels' });
      const packagerB = await request(app).post('/api/v1/packagers')
        .set('Authorization', `Bearer ${tokenB}`).send({ name: 'Other Owner' });
      expect(packagerA.status).toBe(201);
      const walletA = await request(app).post('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ name: 'Main wallet', opening_balance_paise: 2_000_000 });
      const walletB = await request(app).post('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenB}`).set('Idempotency-Key', randomUUID())
        .send({ name: 'Foreign wallet', opening_balance_paise: 2_000_000 });
      expect(walletA.status).toBe(201);
      const bookingBody = {
        packager_id: packagerA.body.packager.id,
        boarding_station: 'Kozhikode', destination_station: 'Chennai',
        journey_date: '2026-10-25', train_identifier: '12626',
        ticket_price_paise: 1_000_000, service_charge_paise: 100_000,
        initial_collected_paise: 850_000, wallet_deducted_paise: 1_000_000,
        wallet_id: walletA.body.wallet.id,
      };
      const createKey = randomUUID();
      const create = () => request(app).post('/api/v1/bookings')
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', createKey).send(bookingBody);
      const concurrent = await Promise.all([create(), create()]);
      expect(concurrent.map((result) => result.status).sort()).toEqual([200, 201]);
      const created = concurrent.find((result) => result.status === 201)!;
      expect(created.body.financials).toMatchObject({
        total_payable_paise: 1_100_000, collected_paise: 850_000,
        wallet_deducted_paise: 1_000_000, balance_due_paise: 250_000,
        advance_credit_paise: 0,
      });
      const detail = await request(app).get(`/api/v1/bookings/${created.body.booking.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(detail.body.financials.balance_due_paise).toBe(250_000);
      expect((await request(app).get(`/api/v1/bookings/${created.body.booking.id}`)
        .set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      const walletDetail = await request(app).get(`/api/v1/wallets/${walletA.body.wallet.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(walletDetail.body.wallet.current_balance_paise).toBe(1_000_000);
      const count = await pool.query<{ bookings: string; receipts: string; debits: string }>(`
        SELECT (SELECT count(*) FROM app.bookings WHERE owner_id = $1) AS bookings,
               (SELECT count(*) FROM app.customer_fund_entries WHERE owner_id = $1) AS receipts,
               (SELECT count(*) FROM app.wallet_entries WHERE owner_id = $1) AS debits`, [ownerA]);
      expect(count.rows[0]).toEqual({ bookings: '1', receipts: '1', debits: '1' });

      const bookingId = created.body.booking.id as string;
      const partial = await request(app).post(`/api/v1/bookings/${bookingId}/collections`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ amount_paise: 100_000, method: 'upi', occurred_at: '2026-10-25T11:00:00Z', note: 'Part payment' });
      expect(partial.status).toBe(201);
      expect(partial.body.financials).toMatchObject({ collected_paise: 950_000,
        balance_due_paise: 150_000, advance_credit_paise: 0 });
      const finalKey = randomUUID();
      const finalBody = { amount_paise: 200_000, method: 'cash',
        occurred_at: '2026-10-25T12:00:00Z', note: 'Overpayment' };
      const collectFinal = () => request(app).post(`/api/v1/bookings/${bookingId}/collections`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', finalKey).send(finalBody);
      const finalPair = await Promise.all([collectFinal(), collectFinal()]);
      expect(finalPair.map((item) => item.status).sort()).toEqual([200, 201]);
      expect(finalPair[0]!.body.financials).toMatchObject({ collected_paise: 1_150_000,
        balance_due_paise: 0, advance_credit_paise: 50_000 });
      const updated = await request(app).get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(updated.body.financials).toMatchObject({ collected_paise: 1_150_000,
        balance_due_paise: 0, advance_credit_paise: 50_000,
        wallet_deducted_paise: 1_000_000 });
      const dashboard = await request(app).get('/api/v1/dashboard')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(dashboard.status).toBe(200);
      expect(dashboard.body).toMatchObject({ booking_count: 1,
        total_payable_paise: 1_100_000, collected_paise: 1_150_000,
        balance_due_paise: 0, advance_credit_paise: 50_000,
        wallet_balance_paise: 1_000_000 });
      expect(dashboard.body.recent_bookings).toHaveLength(1);
      expect((await request(app).get('/api/v1/dashboard')
        .set('Authorization', `Bearer ${tokenB}`)).body.booking_count).toBe(0);
      const timeline = await request(app).get(`/api/v1/bookings/${bookingId}/entries`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(timeline.status).toBe(200);
      expect(timeline.body.items).toHaveLength(4);
      expect(timeline.body.items.filter((item: { source: string }) => item.source === 'customer')).toHaveLength(3);
      expect((await request(app).get(`/api/v1/bookings/${bookingId}/entries`)
        .set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      expect((await request(app).post(`/api/v1/bookings/${bookingId}/collections`)
        .set('Authorization', `Bearer ${tokenB}`).set('Idempotency-Key', randomUUID())
        .send(finalBody)).status).toBe(404);
      const unsupportedMethod = await request(app)
        .post(`/api/v1/bookings/${bookingId}/collections`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('Idempotency-Key', randomUUID())
        .send({ ...finalBody, method: 'card' });
      expect(unsupportedMethod.status).toBe(422);

      const wrongPackager = await request(app).post('/api/v1/bookings')
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ ...bookingBody, packager_id: packagerB.body.packager.id });
      expect(wrongPackager.status).toBe(404);
      const wrongWallet = await request(app).post('/api/v1/bookings')
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ ...bookingBody, wallet_id: walletB.body.wallet.id });
      expect(wrongWallet.status).toBe(404);
      const overdraft = await request(app).post('/api/v1/bookings')
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ ...bookingBody, wallet_deducted_paise: 1_000_001 });
      expect(overdraft.status).toBe(409);
      expect(overdraft.body.error.code).toBe('INSUFFICIENT_WALLET_BALANCE');
      const noMovements = await request(app).post('/api/v1/bookings')
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ ...bookingBody, initial_collected_paise: 0, wallet_deducted_paise: 0, wallet_id: null });
      expect(noMovements.status).toBe(201);
      const statement = await request(app)
        .get(`/api/v1/packagers/${packagerA.body.packager.id}/statement`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(statement.status).toBe(200);
      expect(statement.body.summary).toMatchObject({
        booking_count: 2, total_payable_paise: 2_200_000,
        collected_paise: 1_150_000, per_booking_due_paise: 1_100_000,
        per_booking_credit_paise: 50_000, net_due_paise: 1_050_000,
      });
      expect(statement.body.items).toHaveLength(2);
      const statementPage = await request(app)
        .get(`/api/v1/packagers/${packagerA.body.packager.id}/statement?limit=1`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(statementPage.body.items).toHaveLength(1);
      expect(statementPage.body.next_offset).toBe(1);
      const statementNext = await request(app)
        .get(`/api/v1/packagers/${packagerA.body.packager.id}/statement?limit=1&offset=1`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(statementNext.body.items).toHaveLength(1);
      expect(statementNext.body.next_offset).toBeNull();
      expect((await request(app)
        .get(`/api/v1/packagers/${packagerA.body.packager.id}/statement`)
        .set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
      const finalCount = await pool.query<{ bookings: string; receipts: string; debits: string }>(`
        SELECT (SELECT count(*) FROM app.bookings WHERE owner_id = $1) AS bookings,
               (SELECT count(*) FROM app.customer_fund_entries WHERE owner_id = $1) AS receipts,
               (SELECT count(*) FROM app.wallet_entries WHERE owner_id = $1) AS debits`, [ownerA]);
      expect(finalCount.rows[0]).toEqual({ bookings: '2', receipts: '3', debits: '1' });

      const originalDebitId = (timeline.body.items as Array<{ id: string; entry_type: string }>)
        .find((item) => item.entry_type === 'booking_debit')!.id;
      const refundBody = { original_receipt_id: partial.body.entry.id, amount_paise: 50_000,
        method: 'upi', occurred_at: '2026-10-25T13:00:00Z', reason: 'Returned part payment' };
      const refundKey = randomUUID();
      const customerRefund = () => request(app).post(`/api/v1/bookings/${bookingId}/customer-refunds`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', refundKey).send(refundBody);
      const refundPair = await Promise.all([customerRefund(), customerRefund()]);
      expect(refundPair.map((item) => item.status).sort()).toEqual([200, 201]);
      expect((await request(app).post(`/api/v1/bookings/${bookingId}/customer-refunds`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ ...refundBody, amount_paise: 50_001 })).status).toBe(409);
      expect((await request(app).post(`/api/v1/bookings/${bookingId}/customer-refunds`)
        .set('Authorization', `Bearer ${tokenB}`).set('Idempotency-Key', randomUUID())
        .send(refundBody)).status).toBe(404);
      const reverseReceipt = await request(app).post(`/api/v1/finance/${partial.body.entry.id}/reverse`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ occurred_at: '2026-10-25T14:00:00Z', reason: 'Receipt was entered twice' });
      expect(reverseReceipt.status).toBe(201);
      expect(reverseReceipt.body.entry.amount_paise).toBe(50_000);
      expect((await request(app).post(`/api/v1/finance/${partial.body.entry.id}/reverse`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ occurred_at: '2026-10-25T14:00:00Z', reason: 'Again' })).status).toBe(409);
      const afterCustomer = await request(app).get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(afterCustomer.body.financials).toMatchObject({ collected_paise: 1_050_000,
        balance_due_paise: 50_000, wallet_deducted_paise: 1_000_000 });

      const providerRefundBody = { original_debit_id: originalDebitId, amount_paise: 200_000,
        occurred_at: '2026-10-25T15:00:00Z', reason: 'Rail provider refund' };
      const providerRefund = await request(app).post(`/api/v1/wallets/${walletA.body.wallet.id}/refunds`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send(providerRefundBody);
      expect(providerRefund.status).toBe(201);
      expect(providerRefund.body.wallet.current_balance_paise).toBe(1_200_000);
      expect((await request(app).post(`/api/v1/wallets/${walletA.body.wallet.id}/refunds`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ ...providerRefundBody, amount_paise: 800_001 })).status).toBe(409);
      const reverseDebit = await request(app).post(`/api/v1/finance/${originalDebitId}/reverse`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ occurred_at: '2026-10-25T16:00:00Z', reason: 'Remaining debit was erroneous' });
      expect(reverseDebit.status).toBe(201);
      expect(reverseDebit.body.entry.amount_paise).toBe(800_000);
      expect(reverseDebit.body.wallet.current_balance_paise).toBe(2_000_000);
      expect((await request(app).post(`/api/v1/finance/${originalDebitId}/reverse`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ occurred_at: '2026-10-25T16:00:00Z', reason: 'Again' })).status).toBe(409);
      const additionalDebit = await request(app)
        .post(`/api/v1/wallets/${walletA.body.wallet.id}/booking-debits`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ booking_id: noMovements.body.booking.id, amount_paise: 300_000,
          occurred_at: '2026-10-25T17:00:00Z', note: null });
      expect(additionalDebit.status).toBe(201);
      expect(additionalDebit.body.wallet.current_balance_paise).toBe(1_700_000);
      const adjustment = await request(app)
        .post(`/api/v1/wallets/${walletA.body.wallet.id}/adjustments`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ direction: 'debit', amount_paise: 20_000,
          occurred_at: '2026-10-25T18:00:00Z', reason: 'Provider fee correction' });
      expect(adjustment.status).toBe(201);
      expect(adjustment.body.wallet.current_balance_paise).toBe(1_680_000);
      expect((await request(app).post(`/api/v1/wallets/${walletA.body.wallet.id}/adjustments`)
        .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
        .send({ direction: 'debit', amount_paise: 1_680_001,
          occurred_at: '2026-10-25T18:00:00Z', reason: 'Overdraw attempt' })).status).toBe(409);
      expect((await request(app).get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${tokenA}`)).body.financials).toMatchObject({
        balance_due_paise: 50_000, wallet_deducted_paise: 0 });
      const bookingReport = await request(app)
        .get('/api/v1/reports/bookings?from_date=2026-10-25&to_date=2026-10-25&clock=journey_date&limit=1')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(bookingReport.status).toBe(200);
      expect(bookingReport.body.summary).toMatchObject({ booking_count: 2,
        total_payable_paise: 2_200_000 });
      expect(bookingReport.body.items).toHaveLength(1);
      expect(bookingReport.body.next_offset).toBe(1);
      const collectionReport = await request(app)
        .get('/api/v1/reports/collections?from_date=2026-10-25&to_date=2026-10-25')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(collectionReport.status).toBe(200);
      expect(collectionReport.body.summary).toMatchObject({ receipts_paise: 300_000,
        refunds_paise: 50_000, reversals_paise: 50_000, net_collected_paise: 200_000 });
      const walletReport = await request(app)
        .get('/api/v1/reports/wallets?from_date=2026-10-25&to_date=2026-10-25')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(walletReport.status).toBe(200);
      expect(walletReport.body.summary).toMatchObject({ credits_paise: 1_000_000,
        debits_paise: 320_000, net_movement_paise: 680_000, booking_spend_paise: -700_000 });
      expect((await request(app)
        .get('/api/v1/reports/collections?from_date=2026-10-25&to_date=2026-10-25')
        .set('Authorization', `Bearer ${tokenB}`)).body.summary.entry_count).toBe(0);
      expect((await request(app)
        .get('/api/v1/reports/collections?from_date=2026-10-26&to_date=2026-10-25')
        .set('Authorization', `Bearer ${tokenA}`)).status).toBe(422);
      const competingRefunds = await Promise.all([0, 1].map((index) =>
        request(app).post(`/api/v1/bookings/${bookingId}/customer-refunds`)
          .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
          .send({ original_receipt_id: finalPair[0]!.body.entry.id,
            amount_paise: 150_000, method: 'cash',
            occurred_at: '2026-10-25T19:00:00Z', reason: `Concurrent refund ${index}` })));
      expect(competingRefunds.map((item) => item.status).sort()).toEqual([201, 409]);
      const competingWalletRefunds = await Promise.all([0, 1].map((index) =>
        request(app).post(`/api/v1/wallets/${walletA.body.wallet.id}/refunds`)
          .set('Authorization', `Bearer ${tokenA}`).set('Idempotency-Key', randomUUID())
          .send({ original_debit_id: additionalDebit.body.entry.id,
            amount_paise: 250_000, occurred_at: '2026-10-25T19:30:00Z',
            reason: `Concurrent provider refund ${index}` })));
      expect(competingWalletRefunds.map((item) => item.status).sort()).toEqual([201, 409]);
      const postConcurrent = await request(app).get(`/api/v1/wallets/${walletA.body.wallet.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(postConcurrent.body.wallet.current_balance_paise).toBe(1_930_000);
    } finally {
      try { await cleanup(pool, owners); } finally {
        await pool.end();
        await closePrisma();
        delete process.env.JWT_PRIVATE_KEY_PEM;
        delete process.env.JWT_PUBLIC_KEY_PEM;
      }
    }
  }, 90000);
  it('records an external wallet deduction without a source wallet and excludes fees from fund balance', async () => {
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
      const token = await signAccessToken(owner, session);
      const auth = { Authorization: `Bearer ${token}` };
      const packager = await request(app).post('/api/v1/packagers').set(auth).send({ name: 'External wallet customer' });
      expect(packager.status).toBe(201);
      const create = await request(app).post('/api/v1/bookings').set(auth)
        .set('Idempotency-Key', randomUUID()).send({
          packager_id: packager.body.packager.id,
          boarding_station: 'Delhi', destination_station: 'Jaipur',
          journey_date: '2026-10-25', train_identifier: '12916',
          ticket_price_paise: 1_000_000, service_charge_paise: 100_000,
          initial_collected_paise: 850_000, wallet_deducted_paise: 700_000,
        });
      expect(create.status).toBe(201);
      expect(create.body.financials).toMatchObject({
        collected_paise: 850_000, wallet_deducted_paise: 700_000,
        fund_balance_paise: 300_000, balance_due_paise: 250_000,
      });
      const bookingId = create.body.booking.id as string;
      const stored = await pool.query<{ recorded_wallet_deduction_paise: string }>(
        'SELECT recorded_wallet_deduction_paise FROM app.bookings WHERE id = $1', [bookingId]);
      expect(stored.rows[0]?.recorded_wallet_deduction_paise).toBe('700000');
      expect((await pool.query('SELECT id FROM app.wallet_entries WHERE booking_id = $1', [bookingId])).rowCount).toBe(0);
      const collected = await request(app).post(`/api/v1/bookings/${bookingId}/collections`).set(auth)
        .set('Idempotency-Key', randomUUID()).send({ amount_paise: 100_000, method: 'upi',
          occurred_at: '2026-10-25T11:00:00Z', note: null });
      expect(collected.status).toBe(201);
      expect(collected.body.financials.fund_balance_paise).toBe(300_000);
      const deductionKey = randomUUID();
      const deductionBody = { amount_paise: 50_000,
        occurred_at: '2026-10-25T12:00:00Z', note: 'Additional external spend' };
      const recordDeduction = () => request(app).post(`/api/v1/bookings/${bookingId}/deductions`)
        .set(auth).set('Idempotency-Key', deductionKey).send(deductionBody);
      const firstDeduction = await recordDeduction();
      const replayDeduction = await recordDeduction();
      expect([firstDeduction.status, replayDeduction.status]).toEqual([201, 200]);
      expect(firstDeduction.body.financials).toMatchObject({
        wallet_deducted_paise: 750_000, fund_balance_paise: 250_000,
      });
      expect((await pool.query('SELECT id FROM app.booking_deduction_entries WHERE booking_id = $1',
        [bookingId])).rowCount).toBe(1);
      const detail = await request(app).get(`/api/v1/bookings/${bookingId}`).set(auth);
      expect(detail.body.financials.fund_balance_paise).toBe(250_000);
      const dashboard = await request(app).get('/api/v1/dashboard').set(auth);
      expect(dashboard.body).toMatchObject({ wallet_deducted_paise: 750_000,
        fund_balance_paise: 250_000 });
      const timeline = await request(app).get(`/api/v1/bookings/${bookingId}/entries`).set(auth);
      expect(timeline.body.items.filter((entry: { source: string }) =>
        entry.source === 'recorded_deduction')).toHaveLength(2);
    } finally {
      try { await cleanup(pool, [owner]); } finally {
        await pool.end();
        await closePrisma();
        delete process.env.JWT_PRIVATE_KEY_PEM;
        delete process.env.JWT_PUBLIC_KEY_PEM;
      }
    }
  }, 90000);
  it('edits every booking field and appends balanced correction entries', async () => {
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
      const token = await signAccessToken(owner, session);
      const auth = { Authorization: `Bearer ${token}` };
      const packager = await request(app).post('/api/v1/packagers').set(auth).send({ name: 'Edit customer' });
      expect(packager.status).toBe(201);
      const created = await request(app).post('/api/v1/bookings').set(auth)
        .set('Idempotency-Key', randomUUID()).send({
          packager_id: packager.body.packager.id, boarding_station: 'Delhi',
          destination_station: 'Jaipur', journey_date: '2026-10-25', train_identifier: '12916',
          booking_person_mobile: '+919876543210',
          ticket_price_paise: 100_000, service_charge_paise: 10_000,
          initial_collected_paise: 90_000, wallet_deducted_paise: 80_000,
          notes: 'Original note',
        });
      expect(created.status).toBe(201);
      expect(created.body.booking.booking_person_mobile).toBe('+919876543210');
      const bookingId = created.body.booking.id as string;
      const firstBody = {
        packager_id: packager.body.packager.id, boarding_station: 'New Delhi',
        destination_station: 'Agra', journey_date: '2026-11-01', train_identifier: '12002',
        booking_person_mobile: '9876543211',
        ticket_price_paise: 120_000, service_charge_paise: 5_000,
        collected_paise: 100_000, wallet_deducted_paise: 70_000, notes: 'Corrected route',
        expected_updated_at: created.body.booking.updated_at,
        expected_collected_paise: 90_000, expected_wallet_deducted_paise: 80_000,
        correction_reason: 'Corrected receipt and wallet amount',
      };
      const key = randomUUID();
      const edit = () => request(app).patch(`/api/v1/bookings/${bookingId}`).set(auth)
        .set('Idempotency-Key', key).send(firstBody);
      const first = await edit();
      expect(first.status).toBe(200);
      expect(first.body.booking).toMatchObject({ boarding_station: 'New Delhi',
        destination_station: 'Agra', journey_date: '2026-11-01',
        train_identifier: '12002', booking_person_mobile: '9876543211', notes: 'Corrected route' });
      expect(first.body.financials).toMatchObject({ ticket_price_paise: 120_000,
        service_charge_paise: 5_000, collected_paise: 100_000,
        wallet_deducted_paise: 70_000, fund_balance_paise: 50_000,
        balance_due_paise: 25_000 });
      expect((await edit()).body).toEqual(first.body);
      expect((await request(app).patch(`/api/v1/bookings/${bookingId}`).set(auth)
        .set('Idempotency-Key', randomUUID()).send(firstBody)).status).toBe(409);
      const second = await request(app).patch(`/api/v1/bookings/${bookingId}`).set(auth)
        .set('Idempotency-Key', randomUUID()).send({ ...firstBody,
          expected_updated_at: first.body.booking.updated_at,
          expected_collected_paise: 100_000, expected_wallet_deducted_paise: 70_000,
          collected_paise: 90_000, wallet_deducted_paise: 90_000,
          correction_reason: 'Second amount correction',
        });
      expect(second.status).toBe(200);
      expect(second.body.financials).toMatchObject({ collected_paise: 90_000,
        wallet_deducted_paise: 90_000, fund_balance_paise: 30_000,
        balance_due_paise: 35_000 });
      const dashboard = await request(app).get('/api/v1/dashboard').set(auth);
      expect(dashboard.body).toMatchObject({ collected_paise: 90_000,
        service_charge_paise: 5_000,
        wallet_deducted_paise: 90_000, fund_balance_paise: 30_000 });
      const statement = await request(app).get(`/api/v1/packagers/${packager.body.packager.id}/statement`).set(auth);
      expect(statement.body.summary).toMatchObject({ collected_paise: 90_000,
        net_due_paise: 35_000 });
      const report = await request(app).get('/api/v1/reports/collections?from_date=2026-10-01&to_date=2026-12-31').set(auth);
      expect(report.body.summary).toMatchObject({ net_collected_paise: 90_000,
        adjustment_increase_paise: 10_000, adjustment_decrease_paise: 10_000 });
      const today = new Date().toISOString().slice(0, 10);
      const bookingReport = await request(app).get(`/api/v1/reports/bookings?from_date=${today}&to_date=${today}&packager_id=${packager.body.packager.id}`)
        .set(auth);
      expect(bookingReport.status).toBe(200);
      expect(bookingReport.body.summary.booking_count).toBe(1);
      expect(bookingReport.body.items[0]).toMatchObject({
        packager_name: 'Edit customer', ticket_price_paise: 120_000,
        service_charge_paise: 5_000, collected_paise: 90_000,
        wallet_deducted_paise: 90_000, fund_balance_paise: 30_000,
        balance_due_paise: 35_000, booking_person_mobile: '9876543211', notes: 'Corrected route',
      });
      const allBookingsReport = await request(app)
        .get(`/api/v1/reports/bookings?packager_id=${packager.body.packager.id}`)
        .set(auth);
      expect(allBookingsReport.status).toBe(200);
      expect(allBookingsReport.body).toMatchObject({
        from_date: null, to_date: null,
        summary: { booking_count: 1 },
        items: [{ id: bookingId, packager_name: 'Edit customer' }],
      });
      expect((await request(app)
        .get('/api/v1/reports/bookings?from_date=2026-10-01')
        .set(auth)).status).toBe(422);
      const timeline = await request(app).get(`/api/v1/bookings/${bookingId}/entries`).set(auth);
      expect(timeline.body.items).toHaveLength(6);
      const original = await pool.query<{ amount_paise: string }>(
        "SELECT amount_paise FROM app.customer_fund_entries WHERE booking_id = $1 AND entry_type = 'receipt'", [bookingId]);
      expect(original.rows[0]?.amount_paise).toBe('90000');
    } finally {
      try { await cleanup(pool, [owner]); } finally {
        await pool.end();
        await closePrisma();
        delete process.env.JWT_PRIVATE_KEY_PEM;
        delete process.env.JWT_PUBLIC_KEY_PEM;
      }
    }
  }, 90000);
});

