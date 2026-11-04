import { createHash } from 'node:crypto';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticateAgency } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';
import { ApiError } from '../middleware/api-error.js';
import { businessDate, canTransition, dateOnly, journeyRequestStatuses, ticketTypes } from '../admin/rules.js';
import { journeyRequestJson, transitionRequest } from '../journeys/shared.js';

// What an agency sees after signing in. Everything is read-only except its own
// journey requests. Every query is limited by response.locals.agency, which
// comes from the login. The *Json functions list allowed fields one by one so
// the owner's data never reaches an agency: booking accounts, wallet spending,
// fund balance and internal notes.
const router = Router();
router.use(authenticateAgency);
const uuid = z.uuid();
const station = z.string().trim().min(1).max(160);
const paise = z.number().int().safe().min(0).max(2_000_000_000_000);
const bookingQuery = z.object({
  scope: z.enum(['all', 'upcoming', 'past']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});
const journeyQuery = z.object({
  from_date: z.iso.date().optional(),
  to_date: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});
const requestQuery = pageQuery.extend({ status: z.enum(journeyRequestStatuses).optional() });
const requestBody = z.strictObject({
  boarding_station: station,
  destination_station: station,
  journey_date: z.iso.date(),
  train_identifier: z.string().trim().min(1).max(160).nullable().optional(),
  ticket_type: z.enum(ticketTypes).default('direct'),
  passenger_count: z.number().int().min(1).max(500).default(1),
  note: z.string().trim().max(2000).nullable().optional(),
}).superRefine((body, ctx) => {
  if (body.boarding_station.toLowerCase() === body.destination_station.toLowerCase()) {
    ctx.addIssue({ code: 'custom', path: ['destination_station'], message: 'Destination must differ from boarding' });
  }
});
const acceptBody = z.strictObject({ quoted_total_paise: paise });
// Limits each agency login, not each network address.
const requestLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: (_request, response) => (response as Response).locals.auth.userId as string });

type Agency = { ownerId: string; packagerId: string; packager: { id: string; name: string; phone: string | null;
  creditLimitPaise: bigint | null } };
function agencyOf(response: Response): Agency {
  return response.locals.agency as Agency;
}
function safeMoney(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error('Portal amount exceeds JSON integer range');
  return amount;
}
function notFound(): ApiError {
  return new ApiError(404, 'NOT_FOUND', 'Resource not found');
}
const moneyIn = ['receipt', 'collection_adjustment_increase'];

type PortalLeg = { id: string; sequence: number; boardingStation: string; destinationStation: string; journeyDate: Date;
  trainIdentifier: string; farePaise: bigint; pnr: string | null; ticketStatus: string; cancellationChargePaise: bigint };
function legJson(leg: PortalLeg) {
  return { id: leg.id, sequence: leg.sequence, boarding_station: leg.boardingStation,
    destination_station: leg.destinationStation, journey_date: leg.journeyDate.toISOString().slice(0, 10),
    train_identifier: leg.trainIdentifier, fare_paise: safeMoney(leg.farePaise), pnr: leg.pnr,
    ticket_status: leg.ticketStatus, cancellation_charge_paise: safeMoney(leg.cancellationChargePaise) };
}
type PortalBooking = { id: string; boardingStation: string; destinationStation: string; journeyDate: Date;
  trainIdentifier: string; ticketType: string; bookingPersonMobile: string | null; paymentDueDate: Date | null;
  ticketPricePaise: bigint; serviceChargePaise: bigint; createdAt: Date; legs: PortalLeg[] };
function bookingJson(booking: PortalBooking, collected: bigint) {
  const payable = booking.ticketPricePaise + booking.serviceChargePaise;
  const signed = payable - collected;
  return { id: booking.id, boarding_station: booking.boardingStation,
    destination_station: booking.destinationStation, journey_date: booking.journeyDate.toISOString().slice(0, 10),
    train_identifier: booking.trainIdentifier, ticket_type: booking.ticketType,
    booking_person_mobile: booking.bookingPersonMobile,
    due_date: (booking.paymentDueDate ?? booking.journeyDate).toISOString().slice(0, 10),
    ticket_price_paise: safeMoney(booking.ticketPricePaise), service_charge_paise: safeMoney(booking.serviceChargePaise),
    total_payable_paise: safeMoney(payable), collected_paise: safeMoney(collected),
    balance_due_paise: safeMoney(signed > 0n ? signed : 0n), advance_credit_paise: safeMoney(signed < 0n ? -signed : 0n),
    legs: booking.legs.map(legJson), created_at: booking.createdAt.toISOString() };
}
async function collectedByBooking(ownerId: string, bookingIds: string[]) {
  const entries = await getPrisma().customerFundEntry.groupBy({ by: ['bookingId', 'entryType'],
    where: { ownerId, bookingId: { in: bookingIds } }, _sum: { amountPaise: true } });
  const collected = new Map<string, bigint>();
  for (const entry of entries) {
    const sign = moneyIn.includes(entry.entryType) ? 1n : -1n;
    collected.set(entry.bookingId, (collected.get(entry.bookingId) ?? 0n) + sign * (entry._sum.amountPaise ?? 0n));
  }
  return collected;
}
const withLegs = { legs: { orderBy: { sequence: 'asc' } } } as const;

router.get('/summary', async (_request, response, next) => {
  try {
    const { ownerId, packagerId, packager } = agencyOf(response);
    const today = businessDate();
    const db = getPrisma();
    const [rows, upcoming, openRequests] = await Promise.all([
      db.$queryRaw<Array<{ booking_count: bigint; payable: bigint; collected: bigint; overdue: bigint;
        oldest_due_date: Date | null }>>`
        SELECT count(*)::bigint AS booking_count,
          coalesce(sum(payable), 0)::bigint AS payable,
          coalesce(sum(collected), 0)::bigint AS collected,
          coalesce(sum(CASE WHEN due_date < ${today}::date THEN greatest(payable - collected, 0) END), 0)::bigint AS overdue,
          min(CASE WHEN payable > collected THEN due_date END) AS oldest_due_date
        FROM (
          SELECT coalesce(b.payment_due_date, b.journey_date) AS due_date,
            b.ticket_price_paise + b.service_charge_paise AS payable,
            coalesce(entries.collected, 0) AS collected
          FROM app.bookings b
          LEFT JOIN (
            SELECT booking_id, sum(CASE WHEN entry_type IN ('receipt', 'collection_adjustment_increase')
              THEN amount_paise ELSE -amount_paise END) AS collected
            FROM app.customer_fund_entries WHERE owner_id = ${ownerId}::uuid
            GROUP BY booking_id
          ) entries ON entries.booking_id = b.id
          WHERE b.owner_id = ${ownerId}::uuid AND b.packager_id = ${packagerId}::uuid
        ) balances`,
      db.bookingLeg.count({ where: { ownerId, booking: { packagerId },
        journeyDate: { gte: dateOnly(today) }, ticketStatus: { not: 'cancelled' } } }),
      db.journeyRequest.count({ where: { ownerId, packagerId, status: { in: ['pending', 'quoted', 'accepted'] } } }),
    ]);
    const totals = rows[0]!;
    const netDue = BigInt(totals.payable) - BigInt(totals.collected);
    const limit = packager.creditLimitPaise;
    response.json({ agency: { id: packager.id, name: packager.name, phone: packager.phone },
      date: today, booking_count: safeMoney(BigInt(totals.booking_count)),
      total_payable_paise: safeMoney(BigInt(totals.payable)), collected_paise: safeMoney(BigInt(totals.collected)),
      net_due_paise: safeMoney(netDue > 0n ? netDue : 0n), advance_credit_paise: safeMoney(netDue < 0n ? -netDue : 0n),
      overdue_paise: safeMoney(BigInt(totals.overdue)),
      oldest_due_date: totals.oldest_due_date?.toISOString().slice(0, 10) ?? null,
      credit_limit_paise: limit === null ? null : safeMoney(limit),
      available_credit_paise: limit === null ? null : safeMoney(limit - netDue),
      upcoming_ticket_count: upcoming, open_request_count: openRequests });
  } catch (error) { next(error); }
});

router.get('/bookings', async (request, response, next) => {
  try {
    const query = bookingQuery.parse(request.query);
    const { ownerId, packagerId } = agencyOf(response);
    const today = dateOnly(businessDate());
    const bookings = await getPrisma().booking.findMany({
      where: { ownerId, packagerId,
        ...(query.scope === 'upcoming' ? { journeyDate: { gte: today } } : {}),
        ...(query.scope === 'past' ? { journeyDate: { lt: today } } : {}) },
      include: withLegs, orderBy: [{ journeyDate: query.scope === 'upcoming' ? 'asc' : 'desc' }, { id: 'asc' }],
      skip: query.offset, take: query.limit + 1,
    });
    const page = bookings.slice(0, query.limit);
    const collected = await collectedByBooking(ownerId, page.map((booking) => booking.id));
    response.json({ items: page.map((booking) => bookingJson(booking, collected.get(booking.id) ?? 0n)),
      next_offset: bookings.length > query.limit ? query.offset + query.limit : null });
  } catch (error) { next(error); }
});

router.get('/bookings/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const { ownerId, packagerId } = agencyOf(response);
    const booking = await getPrisma().booking.findFirst({ where: { id, ownerId, packagerId }, include: withLegs });
    if (!booking) throw notFound();
    const collected = await collectedByBooking(ownerId, [id]);
    response.json({ booking: bookingJson(booking, collected.get(id) ?? 0n) });
  } catch (error) { next(error); }
});

// The agency's journey schedule, from today unless a range is given.
router.get('/journeys', async (request, response, next) => {
  try {
    const query = journeyQuery.parse(request.query);
    const { ownerId, packagerId } = agencyOf(response);
    const from = query.from_date ?? businessDate();
    if (query.to_date && from > query.to_date) {
      throw new ApiError(422, 'INVALID_RANGE', 'from_date must not be after to_date');
    }
    const legs = await getPrisma().bookingLeg.findMany({
      where: { ownerId, booking: { packagerId }, ticketStatus: { not: 'cancelled' },
        journeyDate: { gte: dateOnly(from), ...(query.to_date ? { lte: dateOnly(query.to_date) } : {}) } },
      orderBy: [{ journeyDate: 'asc' }, { bookingId: 'asc' }, { sequence: 'asc' }],
      skip: query.offset, take: query.limit + 1,
    });
    const page = legs.slice(0, query.limit);
    response.json({ items: page.map((leg) => ({ ...legJson(leg), booking_id: leg.bookingId })),
      next_offset: legs.length > query.limit ? query.offset + query.limit : null });
  } catch (error) { next(error); }
});

router.get('/payments', async (request, response, next) => {
  try {
    const query = pageQuery.parse(request.query);
    const { ownerId, packagerId } = agencyOf(response);
    const entries = await getPrisma().customerFundEntry.findMany({
      where: { ownerId, booking: { packagerId } },
      select: { id: true, bookingId: true, entryType: true, amountPaise: true, method: true, occurredAt: true,
        booking: { select: { boardingStation: true, destinationStation: true, journeyDate: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip: query.offset, take: query.limit + 1,
    });
    const page = entries.slice(0, query.limit);
    response.json({ items: page.map((entry) => ({ id: entry.id, booking_id: entry.bookingId,
      boarding_station: entry.booking.boardingStation, destination_station: entry.booking.destinationStation,
      journey_date: entry.booking.journeyDate.toISOString().slice(0, 10),
      entry_type: entry.entryType, method: entry.method,
      amount_paise: safeMoney((moneyIn.includes(entry.entryType) ? 1n : -1n) * entry.amountPaise),
      occurred_at: entry.occurredAt.toISOString() })),
    next_offset: entries.length > query.limit ? query.offset + query.limit : null });
  } catch (error) { next(error); }
});

router.get('/journey-requests', async (request, response, next) => {
  try {
    const query = requestQuery.parse(request.query);
    const { ownerId, packagerId } = agencyOf(response);
    const requests = await getPrisma().journeyRequest.findMany({
      where: { ownerId, packagerId, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: query.offset, take: query.limit + 1,
    });
    const page = requests.slice(0, query.limit);
    response.json({ items: page.map(journeyRequestJson),
      next_offset: requests.length > query.limit ? query.offset + query.limit : null });
  } catch (error) { next(error); }
});

router.post('/journey-requests', requestLimit, async (request, response, next) => {
  try {
    const body = requestBody.parse(request.body);
    const key = uuid.safeParse(request.header('Idempotency-Key'));
    if (!key.success) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A UUID Idempotency-Key header is required');
    if (body.journey_date < businessDate()) {
      throw new ApiError(422, 'JOURNEY_DATE_PAST', 'Journey date cannot be in the past');
    }
    const { ownerId, packagerId } = agencyOf(response);
    const userId = response.locals.auth.userId as string;
    const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const result = await getPrisma().$transaction(async (tx) => {
      const claimed = await tx.journeyRequest.createMany({ skipDuplicates: true, data: [{
        ownerId, packagerId, requestedByUserId: userId, idempotencyKey: key.data, payloadHash,
        boardingStation: body.boarding_station, destinationStation: body.destination_station,
        journeyDate: dateOnly(body.journey_date), trainIdentifier: body.train_identifier ?? null,
        ticketType: body.ticket_type, passengerCount: body.passenger_count, agencyNote: body.note ?? null,
      }] });
      const journey = await tx.journeyRequest.findUniqueOrThrow({
        where: { packagerId_idempotencyKey: { packagerId, idempotencyKey: key.data } } });
      if (!claimed.count) {
        if (journey.payloadHash !== payloadHash) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for a different request');
        }
        return { status: 200, journey };
      }
      await tx.auditEvent.create({ data: { ownerId, actorUserId: userId, entityType: 'journey_request',
        entityId: journey.id, action: 'create', afterJson: journeyRequestJson(journey) } });
      return { status: 201, journey };
    });
    response.status(result.status).json({ journey_request: journeyRequestJson(result.journey) });
  } catch (error) { next(error); }
});

router.get('/journey-requests/:id', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const { ownerId, packagerId } = agencyOf(response);
    const journey = await getPrisma().journeyRequest.findFirst({ where: { id, ownerId, packagerId } });
    if (!journey) throw notFound();
    response.json({ journey_request: journeyRequestJson(journey) });
  } catch (error) { next(error); }
});

// The agency states the total it agreed to, so a quote changed at the same
// moment is rejected rather than accepted unseen.
router.post('/journey-requests/:id/accept', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const body = acceptBody.parse(request.body);
    const { ownerId, packagerId } = agencyOf(response);
    const userId = response.locals.auth.userId as string;
    const journey = await getPrisma().$transaction(async (tx) => {
      const current = await tx.journeyRequest.findFirst({ where: { id, ownerId, packagerId },
        select: { status: true, quotedTicketPricePaise: true, quotedServiceChargePaise: true } });
      if (current && canTransition('accept', current.status) && BigInt(body.quoted_total_paise) !==
        (current.quotedTicketPricePaise ?? 0n) + (current.quotedServiceChargePaise ?? 0n)) {
        throw new ApiError(409, 'QUOTE_CHANGED', 'The quote changed. Reload it before accepting');
      }
      // The guard catches a new quote saved between the read above and this update.
      const updated = await transitionRequest(tx, { id, ownerId, packagerId }, 'accept', { status: 'accepted' },
        { quotedTicketPricePaise: current?.quotedTicketPricePaise, quotedServiceChargePaise: current?.quotedServiceChargePaise });
      await tx.auditEvent.create({ data: { ownerId, actorUserId: userId, entityType: 'journey_request',
        entityId: id, action: 'accept', afterJson: journeyRequestJson(updated) } });
      return updated;
    });
    response.json({ journey_request: journeyRequestJson(journey) });
  } catch (error) { next(error); }
});

router.post('/journey-requests/:id/cancel', async (request, response, next) => {
  try {
    const id = uuid.parse(request.params.id);
    const { ownerId, packagerId } = agencyOf(response);
    const userId = response.locals.auth.userId as string;
    const journey = await getPrisma().$transaction(async (tx) => {
      const updated = await transitionRequest(tx, { id, ownerId, packagerId }, 'cancel', { status: 'cancelled' });
      await tx.auditEvent.create({ data: { ownerId, actorUserId: userId, entityType: 'journey_request',
        entityId: id, action: 'cancel', afterJson: journeyRequestJson(updated) } });
      return updated;
    });
    response.json({ journey_request: journeyRequestJson(journey) });
  } catch (error) { next(error); }
});

export { router as portalRouter };
