import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';
import { ApiError } from '../middleware/api-error.js';
import { dateOnly } from '../admin/rules.js';

// Personal IRCTC IDs and agent portals tickets are bought from.
const router = Router();
router.use(authenticate);
const uuid = z.uuid();
const createBody = z.strictObject({
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['personal_id', 'agent_portal']),
  login_id: z.string().trim().min(1).max(160).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const updateBody = createBody.partial().extend({ is_active: z.boolean().optional() }).refine(
  (body) => Object.keys(body).length > 0,
  'At least one field is required',
);
const listQuery = z.object({ include_inactive: z.enum(['true', 'false']).default('false') });
const usageQuery = z.object({ from_date: z.iso.date().optional(), to_date: z.iso.date().optional() })
  .refine((query) => !query.from_date || !query.to_date || query.from_date <= query.to_date,
    'from_date must not be after to_date');

function ownerId(response: Response): string {
  return response.locals.auth.userId as string;
}
function safeMoney(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error('Account amount exceeds JSON integer range');
  return amount;
}
function serialize(account: { id: string; name: string; kind: string; loginId: string | null;
  notes: string | null; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return { id: account.id, name: account.name, kind: account.kind, login_id: account.loginId,
    notes: account.notes, is_active: account.isActive,
    created_at: account.createdAt.toISOString(), updated_at: account.updatedAt.toISOString() };
}

router.get('/', async (request, response, next) => {
  try {
    const query = listQuery.parse(request.query);
    const items = await getPrisma().bookingAccount.findMany({
      where: { ownerId: ownerId(response), ...(query.include_inactive === 'false' ? { isActive: true } : {}) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    response.json({ items: items.map(serialize) });
  } catch (error) { next(error); }
});

router.post('/', async (request, response, next) => {
  try {
    const body = createBody.parse(request.body);
    const account = await getPrisma().bookingAccount.create({ data: {
      ownerId: ownerId(response), name: body.name, kind: body.kind,
      loginId: body.login_id ?? null, notes: body.notes ?? null,
    } });
    response.status(201).json({ booking_account: serialize(account) });
  } catch (error) { next(error); }
});

// Tickets bought through the account, excluding cancelled legs from spend.
router.get('/:id/usage', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const query = usageQuery.parse(request.query);
    const owner = ownerId(response);
    const account = await getPrisma().bookingAccount.findFirst({ where: { id, ownerId: owner } });
    if (!account) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    const journeyDate = { ...(query.from_date ? { gte: dateOnly(query.from_date) } : {}),
      ...(query.to_date ? { lte: dateOnly(query.to_date) } : {}) };
    const rows = await getPrisma().bookingLeg.groupBy({ by: ['ticketStatus'],
      where: { ownerId: owner, bookingAccountId: id,
        ...(query.from_date || query.to_date ? { journeyDate } : {}) },
      _count: { id: true }, _sum: { farePaise: true } });
    const byStatus = Object.fromEntries(rows.map((row) => [row.ticketStatus, row._count.id]));
    const active = rows.filter((row) => row.ticketStatus !== 'cancelled');
    response.json({ booking_account: serialize(account), usage: {
      from_date: query.from_date ?? null, to_date: query.to_date ?? null,
      ticket_count: active.reduce((total, row) => total + row._count.id, 0),
      cancelled_count: byStatus.cancelled ?? 0,
      fare_total_paise: safeMoney(active.reduce((total, row) => total + (row._sum.farePaise ?? 0n), 0n)),
      by_status: byStatus,
    } });
  } catch (error) { next(error); }
});

router.get('/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const account = await getPrisma().bookingAccount.findFirst({ where: { id, ownerId: ownerId(response) } });
    if (!account) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    response.json({ booking_account: serialize(account) });
  } catch (error) { next(error); }
});

router.patch('/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const body = updateBody.parse(request.body);
    const owner = ownerId(response);
    const result = await getPrisma().bookingAccount.updateMany({
      where: { id, ownerId: owner },
      data: { ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.login_id !== undefined ? { loginId: body.login_id } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}) },
    });
    if (!result.count) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    const account = await getPrisma().bookingAccount.findFirstOrThrow({ where: { id, ownerId: owner } });
    response.json({ booking_account: serialize(account) });
  } catch (error) { next(error); }
});

export { router as bookingAccountRouter };
