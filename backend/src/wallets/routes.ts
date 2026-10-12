import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';
import { ApiError } from '../middleware/api-error.js';

const router = Router();
router.use(authenticate);
const uuid = z.uuid();
const paise = z.number().int().safe().min(0).max(1_000_000_000_000);
const createBody = z.strictObject({ name: z.string().trim().min(1).max(120), opening_balance_paise: paise });
const topupBody = z.strictObject({ amount_paise: paise.positive(),
  occurred_at: z.iso.datetime({ offset: true }), note: z.string().trim().max(2000).nullable().optional() });
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: uuid.optional(), include_inactive: z.enum(['true', 'false']).default('false') });

function operationId(header: string | undefined): string {
  const parsed = uuid.safeParse(header);
  if (!parsed.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A UUID Idempotency-Key header is required');
  return parsed.data;
}
function payloadHash(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function walletJson(wallet: { id: string; name: string; openingBalancePaise: bigint;
  currentBalancePaise: bigint; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return { id: wallet.id, name: wallet.name,
    opening_balance_paise: Number(wallet.openingBalancePaise),
    current_balance_paise: Number(wallet.currentBalancePaise),
    is_active: wallet.isActive, created_at: wallet.createdAt.toISOString(),
    updated_at: wallet.updatedAt.toISOString() };
}
function entryJson(entry: { id: string; entryType: string; amountPaise: bigint;
  bookingId: string | null; reversalOfEntryId: string | null;
  occurredAt: Date; note: string | null; createdAt: Date }) {
  return { id: entry.id, entry_type: entry.entryType, amount_paise: Number(entry.amountPaise),
    booking_id: entry.bookingId, original_entry_id: entry.reversalOfEntryId,
    occurred_at: entry.occurredAt.toISOString(), note: entry.note,
    created_at: entry.createdAt.toISOString() };
}

router.get('/', async (request, response, next) => {
  try {
    const query = listQuery.parse(request.query);
    const owner = response.locals.auth.userId as string;
    if (query.cursor && !await getPrisma().wallet.findFirst({ where: { id: query.cursor, ownerId: owner }, select: { id: true } })) {
      throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    }
    const wallets = await getPrisma().wallet.findMany({
      where: { ownerId: owner, ...(query.include_inactive === 'false' ? { isActive: true } : {}) },
      orderBy: { id: 'asc' }, take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = wallets.slice(0, query.limit);
    response.json({ items: page.map(walletJson), next_cursor: wallets.length > query.limit ? page.at(-1)?.id : null });
  } catch (error) { next(error); }
});

router.post('/', async (request, response, next) => {
  try {
    const body = createBody.parse(request.body);
    const owner = response.locals.auth.userId as string;
    const requestId = operationId(request.header('Idempotency-Key'));
    const hash = payloadHash(body);
    const result = await getPrisma().$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        INSERT INTO app.operation_requests (owner_id, request_id, operation_type, payload_hash)
        VALUES (${owner}::uuid, ${requestId}::uuid, 'create_wallet', ${hash})
        ON CONFLICT DO NOTHING`;
      if (!claimed) {
        const previous = await tx.operationRequest.findUniqueOrThrow({ where: { ownerId_requestId: { ownerId: owner, requestId } } });
        if (previous.operationType !== 'create_wallet' || previous.payloadHash !== hash || !previous.resultJson) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different request');
        }
        return { status: 200, body: previous.resultJson };
      }
      const wallet = await tx.wallet.create({ data: { ownerId: owner, name: body.name,
        openingBalancePaise: BigInt(body.opening_balance_paise),
        currentBalancePaise: BigInt(body.opening_balance_paise) } });
      const bodyJson = { wallet: walletJson(wallet) };
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'wallet', entityId: wallet.id, action: 'create', afterJson: bodyJson.wallet } });
      await tx.operationRequest.update({ where: { ownerId_requestId: { ownerId: owner, requestId } },
        data: { resultJson: bodyJson, completedAt: new Date() } });
      return { status: 201, body: bodyJson };
    });
    response.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

router.get('/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const wallet = await getPrisma().wallet.findFirst({ where: { id, ownerId: response.locals.auth.userId } });
    if (!wallet) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    response.json({ wallet: walletJson(wallet) });
  } catch (error) { next(error); }
});

router.get('/:id/entries', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const query = listQuery.parse({ limit: request.query.limit, cursor: request.query.cursor });
    const owner = response.locals.auth.userId as string;
    if (!await getPrisma().wallet.findFirst({ where: { id, ownerId: owner }, select: { id: true } })) {
      throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    }
    if (query.cursor && !await getPrisma().walletEntry.findFirst({
      where: { id: query.cursor, ownerId: owner, walletId: id }, select: { id: true },
    })) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    const entries = await getPrisma().walletEntry.findMany({
      where: { ownerId: owner, walletId: id }, orderBy: { id: 'asc' }, take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = entries.slice(0, query.limit);
    response.json({ items: page.map(entryJson), next_cursor: entries.length > query.limit ? page.at(-1)?.id : null });
  } catch (error) { next(error); }
});

router.post('/:id/top-ups', async (request, response, next) => {
  try {
    const walletId = uuid.parse(request.params.id);
    const body = topupBody.parse(request.body);
    const owner = response.locals.auth.userId as string;
    const requestId = operationId(request.header('Idempotency-Key'));
    const hash = payloadHash({ walletId, ...body });
    const result = await getPrisma().$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        INSERT INTO app.operation_requests (owner_id, request_id, operation_type, payload_hash)
        VALUES (${owner}::uuid, ${requestId}::uuid, 'wallet_topup', ${hash})
        ON CONFLICT DO NOTHING`;
      if (!claimed) {
        const previous = await tx.operationRequest.findUniqueOrThrow({ where: { ownerId_requestId: { ownerId: owner, requestId } } });
        if (previous.operationType !== 'wallet_topup' || previous.payloadHash !== hash || !previous.resultJson) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different request');
        }
        return { status: 200, body: previous.resultJson };
      }
      const locked = await tx.$queryRaw<Array<{ id: string; current_balance_paise: bigint }>>`
        SELECT id, current_balance_paise FROM app.wallets
        WHERE id = ${walletId}::uuid AND owner_id = ${owner}::uuid FOR UPDATE`;
      if (!locked.length) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
      if (BigInt(locked[0]!.current_balance_paise) + BigInt(body.amount_paise) > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ApiError(422, 'WALLET_BALANCE_LIMIT', 'Wallet balance exceeds the supported amount');
      }
      const entry = await tx.walletEntry.create({ data: { ownerId: owner, walletId,
        entryType: 'top_up', amountPaise: BigInt(body.amount_paise),
        occurredAt: new Date(body.occurred_at), note: body.note ?? null,
        operationRequestId: requestId } });
      const wallet = await tx.wallet.update({ where: { id: walletId },
        data: { currentBalancePaise: { increment: BigInt(body.amount_paise) } } });
      const bodyJson = { wallet: walletJson(wallet), entry: entryJson(entry) };
      await tx.auditEvent.create({ data: { ownerId: owner, actorUserId: owner,
        entityType: 'wallet_entry', entityId: entry.id, action: 'topup', afterJson: bodyJson.entry } });
      await tx.operationRequest.update({ where: { ownerId_requestId: { ownerId: owner, requestId } },
        data: { resultJson: bodyJson, completedAt: new Date() } });
      return { status: 201, body: bodyJson };
    });
    response.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

export { router as walletRouter };
