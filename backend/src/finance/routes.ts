import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../middleware/api-error.js';

const router = Router();
router.use(authenticate);
const uuid = z.uuid();
const amount = z.number().int().safe().positive().max(1_000_000_000_000);
const occurred_at = z.iso.datetime({ offset: true });
const reason = z.string().trim().min(3).max(2000);
const note = z.string().trim().max(2000).nullable().optional();
const debitBody = z.strictObject({ booking_id: uuid, amount_paise: amount, occurred_at, note });
const walletRefundBody = z.strictObject({ original_debit_id: uuid, amount_paise: amount, occurred_at, reason });
const customerRefundBody = z.strictObject({ original_receipt_id: uuid, amount_paise: amount,
  method: z.enum(['cash', 'upi', 'bank', 'other']), occurred_at, reason });
const reverseBody = z.strictObject({ occurred_at, reason });
const adjustmentBody = z.strictObject({ direction: z.enum(['credit', 'debit']),
  amount_paise: amount, occurred_at, reason });

function safeMoney(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new ApiError(422, 'AMOUNT_LIMIT', 'Amount exceeds JSON integer range');
  return result;
}
function entryJson(entry: { id: string; entryType: string; amountPaise: bigint;
  occurredAt: Date; reversalOfEntryId: string | null; note: string | null }) {
  return { id: entry.id, entry_type: entry.entryType, amount_paise: safeMoney(entry.amountPaise),
    occurred_at: entry.occurredAt.toISOString(), original_entry_id: entry.reversalOfEntryId,
    note: entry.note };
}
function walletJson(wallet: { id: string; currentBalancePaise: bigint }) {
  return { id: wallet.id, current_balance_paise: safeMoney(wallet.currentBalancePaise) };
}
function ownerId(response: Response): string { return response.locals.auth.userId as string; }
function keyFrom(request: Request): string {
  const result = uuid.safeParse(request.header('Idempotency-Key'));
  if (!result.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A UUID Idempotency-Key header is required');
  return result.data;
}
async function perform(request: Request, response: Response, operationType: string,
  payload: object, action: (tx: Prisma.TransactionClient, owner: string, key: string) => Promise<Prisma.InputJsonObject>) {
  const owner = ownerId(response);
  const key = keyFrom(request);
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const result = await getPrisma().$transaction(async (tx) => {
    const claimed = await tx.$executeRaw`
      INSERT INTO app.operation_requests (owner_id, request_id, operation_type, payload_hash)
      VALUES (${owner}::uuid, ${key}::uuid, ${operationType}, ${hash})
      ON CONFLICT DO NOTHING`;
    if (!claimed) {
      const previous = await tx.operationRequest.findUniqueOrThrow({
        where: { ownerId_requestId: { ownerId: owner, requestId: key } },
      });
      if (previous.operationType !== operationType || previous.payloadHash !== hash || !previous.resultJson) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different request');
      }
      return { status: 200, body: previous.resultJson };
    }
    const body = await action(tx, owner, key);
    await tx.operationRequest.update({ where: { ownerId_requestId: { ownerId: owner, requestId: key } },
      data: { resultJson: body, completedAt: new Date() } });
    return { status: 201, body };
  });
  response.status(result.status).json(result.body);
}
async function lockWallet(tx: Prisma.TransactionClient, owner: string, walletId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; current_balance_paise: bigint; is_active: boolean }>>`
    SELECT id, current_balance_paise, is_active FROM app.wallets
    WHERE id = ${walletId}::uuid AND owner_id = ${owner}::uuid FOR UPDATE`;
  if (!rows[0]?.is_active) throw new ApiError(404, 'NOT_FOUND', 'Wallet not found');
  return rows[0];
}
async function lockBooking(tx: Prisma.TransactionClient, owner: string, bookingId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM app.bookings WHERE id = ${bookingId}::uuid
    AND owner_id = ${owner}::uuid FOR UPDATE`;
  if (!rows.length) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
}
async function usedCustomer(tx: Prisma.TransactionClient, owner: string, originalId: string) {
  const rows = await tx.customerFundEntry.aggregate({ where: { ownerId: owner,
    reversalOfEntryId: originalId, entryType: { in: ['refund', 'reversal'] } },
    _sum: { amountPaise: true } });
  return rows._sum.amountPaise ?? 0n;
}
async function usedWallet(tx: Prisma.TransactionClient, owner: string, originalId: string) {
  const rows = await tx.walletEntry.aggregate({ where: { ownerId: owner,
    reversalOfEntryId: originalId, entryType: { in: ['wallet_refund', 'debit_reversal'] } },
    _sum: { amountPaise: true } });
  return rows._sum.amountPaise ?? 0n;
}
function requireAvailable(requested: bigint, available: bigint) {
  if (requested > available || available <= 0n) {
    throw new ApiError(409, 'AMOUNT_EXCEEDS_REMAINING', 'Amount exceeds the remaining original entry');
  }
}
function requireWalletCapacity(balance: bigint, increment: bigint) {
  if (balance + increment > 1_000_000_000_000n) {
    throw new ApiError(409, 'WALLET_BALANCE_LIMIT', 'Wallet balance exceeds the supported amount');
  }
}
async function audit(tx: Prisma.TransactionClient, owner: string, entityType: string,
  entityId: string, action: string, reasonText: string | null, after: Prisma.InputJsonObject) {
  await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
    entityType, entityId, action, reason: reasonText, afterJson: after } });
}

router.post('/wallets/:id/booking-debits', async (request, response, next) => {
  try {
    const walletId = uuid.parse(request.params.id);
    const body = debitBody.parse(request.body);
    await perform(request, response, 'wallet_booking_debit', { walletId, ...body }, async (tx, owner, key) => {
      const wallet = await lockWallet(tx, owner, walletId);
      const booking = await tx.booking.findFirst({ where: { id: body.booking_id, ownerId: owner }, select: { id: true } });
      if (!booking) throw new ApiError(404, 'NOT_FOUND', 'Booking not found');
      if (wallet.current_balance_paise < BigInt(body.amount_paise)) {
        throw new ApiError(409, 'INSUFFICIENT_WALLET_BALANCE', 'Wallet balance is insufficient');
      }
      const entry = await tx.walletEntry.create({ data: { ownerId: owner, walletId,
        bookingId: body.booking_id, entryType: 'booking_debit', amountPaise: BigInt(body.amount_paise),
        occurredAt: new Date(body.occurred_at), note: body.note ?? null, operationRequestId: key } });
      const updated = await tx.wallet.update({ where: { id: walletId },
        data: { currentBalancePaise: { decrement: BigInt(body.amount_paise) } } });
      const result = { wallet: walletJson(updated), entry: entryJson(entry) };
      await audit(tx, owner, 'wallet_entry', entry.id, 'booking_debit', null, result);
      return result;
    });
  } catch (error) { next(error); }
});

router.post('/wallets/:id/refunds', async (request, response, next) => {
  try {
    const walletId = uuid.parse(request.params.id);
    const body = walletRefundBody.parse(request.body);
    await perform(request, response, 'wallet_provider_refund', { walletId, ...body }, async (tx, owner, key) => {
      const wallet = await lockWallet(tx, owner, walletId);
      const original = await tx.walletEntry.findFirst({ where: { id: body.original_debit_id,
        ownerId: owner, walletId, entryType: 'booking_debit' } });
      if (!original?.bookingId) throw new ApiError(404, 'NOT_FOUND', 'Original debit not found');
      requireAvailable(BigInt(body.amount_paise), original.amountPaise - await usedWallet(tx, owner, original.id));
      requireWalletCapacity(wallet.current_balance_paise, BigInt(body.amount_paise));
      const entry = await tx.walletEntry.create({ data: { ownerId: owner, walletId,
        bookingId: original.bookingId, entryType: 'wallet_refund', amountPaise: BigInt(body.amount_paise),
        reversalOfEntryId: original.id, occurredAt: new Date(body.occurred_at),
        note: body.reason, operationRequestId: key } });
      const updated = await tx.wallet.update({ where: { id: walletId },
        data: { currentBalancePaise: { increment: BigInt(body.amount_paise) } } });
      const result = { wallet: walletJson(updated), entry: entryJson(entry) };
      await audit(tx, owner, 'wallet_entry', entry.id, 'provider_refund', body.reason, result);
      return result;
    });
  } catch (error) { next(error); }
});

router.post('/wallets/:id/adjustments', async (request, response, next) => {
  try {
    const walletId = uuid.parse(request.params.id);
    const body = adjustmentBody.parse(request.body);
    await perform(request, response, 'wallet_adjustment', { walletId, ...body }, async (tx, owner, key) => {
      const wallet = await lockWallet(tx, owner, walletId);
      const value = BigInt(body.amount_paise);
      if (body.direction === 'credit') requireWalletCapacity(wallet.current_balance_paise, value);
      else if (wallet.current_balance_paise < value) {
        throw new ApiError(409, 'INSUFFICIENT_WALLET_BALANCE', 'Wallet balance is insufficient');
      }
      const entry = await tx.walletEntry.create({ data: { ownerId: owner, walletId,
        entryType: body.direction === 'credit' ? 'manual_adjustment_credit' : 'manual_adjustment_debit',
        amountPaise: value, occurredAt: new Date(body.occurred_at), note: body.reason,
        operationRequestId: key } });
      const updated = await tx.wallet.update({ where: { id: walletId }, data: {
        currentBalancePaise: body.direction === 'credit' ? { increment: value } : { decrement: value },
      } });
      const result = { wallet: walletJson(updated), entry: entryJson(entry) };
      await audit(tx, owner, 'wallet_entry', entry.id, 'manual_adjustment', body.reason, result);
      return result;
    });
  } catch (error) { next(error); }
});

router.post('/bookings/:id/customer-refunds', async (request, response, next) => {
  try {
    const bookingId = uuid.parse(request.params.id);
    const body = customerRefundBody.parse(request.body);
    await perform(request, response, 'customer_refund', { bookingId, ...body }, async (tx, owner, key) => {
      await lockBooking(tx, owner, bookingId);
      const original = await tx.customerFundEntry.findFirst({ where: { id: body.original_receipt_id,
        ownerId: owner, bookingId, entryType: 'receipt' } });
      if (!original) throw new ApiError(404, 'NOT_FOUND', 'Original receipt not found');
      requireAvailable(BigInt(body.amount_paise), original.amountPaise - await usedCustomer(tx, owner, original.id));
      const entry = await tx.customerFundEntry.create({ data: { ownerId: owner, bookingId,
        entryType: 'refund', amountPaise: BigInt(body.amount_paise), method: body.method,
        reversalOfEntryId: original.id, occurredAt: new Date(body.occurred_at),
        note: body.reason, operationRequestId: key } });
      const result = { entry: entryJson(entry) };
      await audit(tx, owner, 'customer_entry', entry.id, 'customer_refund', body.reason, result);
      return result;
    });
  } catch (error) { next(error); }
});

router.post('/finance/:entryId/reverse', async (request, response, next) => {
  try {
    const entryId = uuid.parse(request.params.entryId);
    const body = reverseBody.parse(request.body);
    await perform(request, response, 'reverse_finance_entry', { entryId, ...body }, async (tx, owner, key) => {
      const receipt = await tx.customerFundEntry.findFirst({ where: { id: entryId,
        ownerId: owner, entryType: 'receipt' } });
      if (receipt) {
        await lockBooking(tx, owner, receipt.bookingId);
        const remaining = receipt.amountPaise - await usedCustomer(tx, owner, receipt.id);
        requireAvailable(remaining, remaining);
        const entry = await tx.customerFundEntry.create({ data: { ownerId: owner,
          bookingId: receipt.bookingId, entryType: 'reversal', amountPaise: remaining,
          reversalOfEntryId: receipt.id, occurredAt: new Date(body.occurred_at),
          note: body.reason, operationRequestId: key } });
        const result = { entry: entryJson(entry) };
        await audit(tx, owner, 'customer_entry', entry.id, 'receipt_reversal', body.reason, result);
        return result;
      }
      const debit = await tx.walletEntry.findFirst({ where: { id: entryId,
        ownerId: owner, entryType: 'booking_debit' } });
      if (!debit?.bookingId) throw new ApiError(404, 'NOT_FOUND', 'Reversible entry not found');
      const wallet = await lockWallet(tx, owner, debit.walletId);
      const remaining = debit.amountPaise - await usedWallet(tx, owner, debit.id);
      requireAvailable(remaining, remaining);
      requireWalletCapacity(wallet.current_balance_paise, remaining);
      const entry = await tx.walletEntry.create({ data: { ownerId: owner,
        walletId: debit.walletId, bookingId: debit.bookingId,
        entryType: 'debit_reversal', amountPaise: remaining,
        reversalOfEntryId: debit.id, occurredAt: new Date(body.occurred_at),
        note: body.reason, operationRequestId: key } });
      const updated = await tx.wallet.update({ where: { id: debit.walletId },
        data: { currentBalancePaise: { increment: remaining } } });
      const result = { wallet: walletJson(updated), entry: entryJson(entry) };
      await audit(tx, owner, 'wallet_entry', entry.id, 'debit_reversal', body.reason, result);
      return result;
    });
  } catch (error) { next(error); }
});

export { router as financeRouter };
