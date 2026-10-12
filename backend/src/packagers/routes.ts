import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';

const router = Router();
router.use(authenticate);
const uuid = z.uuid();
const createBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
const updateBody = createBody.partial().extend({ is_archived: z.boolean().optional() }).refine(
  (body) => Object.keys(body).length > 0,
  'At least one field is required',
);
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: uuid.optional(),
  search: z.string().trim().max(120).optional(),
  include_archived: z.enum(['true', 'false']).default('false'),
});
const statementQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

function ownerId(response: Response): string {
  return response.locals.auth.userId as string;
}
function notFound(response: Response) {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found', request_id: response.locals.requestId } });
}
function safeMoney(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error('Statement amount exceeds JSON integer range');
  return amount;
}
function serialize(packager: {
  id: string; name: string; phone: string | null; notes: string | null;
  isArchived: boolean; createdAt: Date; updatedAt: Date;
}) {
  return { id: packager.id, name: packager.name, phone: packager.phone,
    notes: packager.notes, is_archived: packager.isArchived,
    created_at: packager.createdAt.toISOString(), updated_at: packager.updatedAt.toISOString() };
}

router.get('/', async (request, response, next) => {
  try {
    const query = listQuery.parse(request.query);
    if (query.cursor) {
      const cursorOwner = await getPrisma().packager.findFirst({
        where: { id: query.cursor, ownerId: ownerId(response) }, select: { id: true },
      });
      if (!cursorOwner) { notFound(response); return; }
    }
    const items = await getPrisma().packager.findMany({
      where: { ownerId: ownerId(response),
        ...(query.include_archived === 'false' ? { isArchived: false } : {}),
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = items.slice(0, query.limit);
    response.json({ items: page.map(serialize), next_cursor: items.length > query.limit ? page.at(-1)?.id : null });
  } catch (error) { next(error); }
});

router.post('/', async (request, response, next) => {
  try {
    const body = createBody.parse(request.body);
    const packager = await getPrisma().packager.create({ data: {
      ownerId: ownerId(response), name: body.name, phone: body.phone ?? null, notes: body.notes ?? null,
    } });
    response.status(201).json({ packager: serialize(packager) });
  } catch (error) { next(error); }
});

router.get('/:id/statement', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const query = statementQuery.parse(request.query);
    const owner = ownerId(response);
    const packager = await getPrisma().packager.findFirst({ where: { id, ownerId: owner } });
    if (!packager) { notFound(response); return; }
    const db = getPrisma();
    const [totals, bookings] = await Promise.all([
      db.$queryRaw<Array<{ booking_count: bigint; payable: bigint; collected: bigint;
        due: bigint; credit: bigint }>>`
        SELECT count(*)::bigint AS booking_count,
          coalesce(sum(payable), 0)::bigint AS payable,
          coalesce(sum(collected), 0)::bigint AS collected,
          coalesce(sum(greatest(payable - collected, 0)), 0)::bigint AS due,
          coalesce(sum(greatest(collected - payable, 0)), 0)::bigint AS credit
        FROM (
          SELECT b.ticket_price_paise + b.service_charge_paise AS payable,
            coalesce(entries.collected, 0) AS collected
          FROM app.bookings b
          LEFT JOIN (
            SELECT booking_id, sum(CASE WHEN entry_type IN ('receipt', 'collection_adjustment_increase')
              THEN amount_paise ELSE -amount_paise END) AS collected
            FROM app.customer_fund_entries WHERE owner_id = ${owner}::uuid
            GROUP BY booking_id
          ) entries ON entries.booking_id = b.id
          WHERE b.owner_id = ${owner}::uuid AND b.packager_id = ${id}::uuid
        ) balances`,
      db.booking.findMany({
      where: { ownerId: owner, packagerId: id },
      select: { id: true, boardingStation: true, destinationStation: true,
        journeyDate: true, trainIdentifier: true, ticketPricePaise: true,
        serviceChargePaise: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: query.offset, take: query.limit + 1,
      }),
    ]);
    const page = bookings.slice(0, query.limit);
    const entries = await db.customerFundEntry.groupBy({
      by: ['bookingId', 'entryType'],
      where: { ownerId: owner, bookingId: { in: page.map((booking) => booking.id) } },
      _sum: { amountPaise: true },
    });
    const collectedByBooking = new Map<string, bigint>();
    for (const entry of entries) {
      const sign = entry.entryType === 'receipt' || entry.entryType === 'collection_adjustment_increase' ? 1n : -1n;
      collectedByBooking.set(entry.bookingId,
        (collectedByBooking.get(entry.bookingId) ?? 0n) + sign * (entry._sum.amountPaise ?? 0n));
    }
    const items = page.map((booking) => {
      const total = booking.ticketPricePaise + booking.serviceChargePaise;
      const received = collectedByBooking.get(booking.id) ?? 0n;
      const signed = total - received;
      return { id: booking.id, boarding_station: booking.boardingStation,
        destination_station: booking.destinationStation,
        journey_date: booking.journeyDate.toISOString().slice(0, 10),
        train_identifier: booking.trainIdentifier,
        total_payable_paise: safeMoney(total), collected_paise: safeMoney(received),
        balance_due_paise: safeMoney(signed > 0n ? signed : 0n),
        advance_credit_paise: safeMoney(signed < 0n ? -signed : 0n) };
    });
    const aggregate = totals[0]!;
    const signed = aggregate.payable - aggregate.collected;
    response.json({ packager: serialize(packager), summary: {
      booking_count: safeMoney(aggregate.booking_count),
      total_payable_paise: safeMoney(aggregate.payable),
      collected_paise: safeMoney(aggregate.collected),
      per_booking_due_paise: safeMoney(aggregate.due),
      per_booking_credit_paise: safeMoney(aggregate.credit),
      signed_balance_paise: safeMoney(signed),
      net_due_paise: safeMoney(signed > 0n ? signed : 0n),
      net_credit_paise: safeMoney(signed < 0n ? -signed : 0n),
    }, items, next_offset: bookings.length > query.limit ? query.offset + query.limit : null });
  } catch (error) { next(error); }
});

router.get('/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const packager = await getPrisma().packager.findFirst({ where: { id, ownerId: ownerId(response) } });
    if (!packager) { notFound(response); return; }
    response.json({ packager: serialize(packager) });
  } catch (error) { next(error); }
});

router.patch('/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const body = updateBody.parse(request.body);
    const owner = ownerId(response);
    const result = await getPrisma().packager.updateMany({
      where: { id, ownerId: owner },
      data: { ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.is_archived !== undefined ? { isArchived: body.is_archived } : {}) },
    });
    if (!result.count) { notFound(response); return; }
    const packager = await getPrisma().packager.findFirstOrThrow({ where: { id, ownerId: owner } });
    response.json({ packager: serialize(packager) });
  } catch (error) { next(error); }
});

export { router as packagerRouter };
