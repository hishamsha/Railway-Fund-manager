import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';
import { ApiError } from '../middleware/api-error.js';
import { addDays, businessDate, dateOnly, ticketStatuses } from '../admin/rules.js';
import { legJson } from '../bookings/legs.js';

// Admin views over tickets and dues: ticket tracker, journey calendar, the
// daily agenda and packagers with pending payments. "Today" is the India date.
const router = Router();
router.use(authenticate);
const uuid = z.uuid();
const ticketQuery = z.object({
  status: z.enum(ticketStatuses).optional(),
  booking_account_id: uuid.optional(),
  packager_id: uuid.optional(),
  from_date: z.iso.date().optional(),
  to_date: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});
const calendarQuery = z.object({ from_date: z.iso.date(), to_date: z.iso.date() }).refine(
  (query) => query.from_date <= query.to_date && query.to_date <= addDays(query.from_date, 62),
  'Choose a range of at most 63 days',
);
const agendaQuery = z.object({ date: z.iso.date().optional() });
const pendingQuery = z.object({ date: z.iso.date().optional(),
  include_settled: z.enum(['true', 'false']).default('false') });

function ownerId(response: Response): string {
  return response.locals.auth.userId as string;
}
function safeMoney(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error('Tracker amount exceeds JSON integer range');
  return amount;
}

const legInclude = { booking: { select: { id: true, packagerId: true, bookingPersonMobile: true,
  ticketType: true, packager: { select: { name: true } } } } } as const;
type TrackedLeg = Parameters<typeof legJson>[0] & { booking: { id: string; packagerId: string;
  bookingPersonMobile: string | null; ticketType: string; packager: { name: string } } };
function trackedLegJson(leg: TrackedLeg) {
  return { ...legJson(leg), booking_id: leg.booking.id, packager_id: leg.booking.packagerId,
    packager_name: leg.booking.packager.name, ticket_type: leg.booking.ticketType,
    booking_person_mobile: leg.booking.bookingPersonMobile };
}

router.get('/tickets', async (request, response, next) => {
  try {
    const query = ticketQuery.parse(request.query);
    if (query.from_date && query.to_date && query.from_date > query.to_date) {
      throw new ApiError(422, 'INVALID_RANGE', 'from_date must not be after to_date');
    }
    const legs = await getPrisma().bookingLeg.findMany({
      where: { ownerId: ownerId(response),
        ...(query.status ? { ticketStatus: query.status } : {}),
        ...(query.booking_account_id ? { bookingAccountId: query.booking_account_id } : {}),
        ...(query.packager_id ? { booking: { packagerId: query.packager_id } } : {}),
        ...(query.from_date || query.to_date ? { journeyDate: {
          ...(query.from_date ? { gte: dateOnly(query.from_date) } : {}),
          ...(query.to_date ? { lte: dateOnly(query.to_date) } : {}) } } : {}) },
      include: legInclude,
      orderBy: [{ journeyDate: 'asc' }, { bookingId: 'asc' }, { sequence: 'asc' }],
      skip: query.offset, take: query.limit + 1,
    });
    const page = legs.slice(0, query.limit);
    response.json({ items: page.map(trackedLegJson),
      next_offset: legs.length > query.limit ? query.offset + query.limit : null });
  } catch (error) { next(error); }
});

router.get('/calendar', async (request, response, next) => {
  try {
    const query = calendarQuery.parse(request.query);
    const rows = await getPrisma().bookingLeg.groupBy({ by: ['journeyDate', 'ticketStatus'],
      where: { ownerId: ownerId(response),
        journeyDate: { gte: dateOnly(query.from_date), lte: dateOnly(query.to_date) } },
      _count: { id: true } });
    const days = new Map<string, { date: string; total: number; by_status: Record<string, number> }>();
    for (const row of rows) {
      const date = row.journeyDate.toISOString().slice(0, 10);
      const day = days.get(date) ?? { date, total: 0, by_status: {} };
      day.total += row._count.id;
      day.by_status[row.ticketStatus] = row._count.id;
      days.set(date, day);
    }
    response.json({ from_date: query.from_date, to_date: query.to_date,
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  } catch (error) { next(error); }
});

type DueRow = { id: string; packager_id: string; packager_name: string; boarding_station: string;
  destination_station: string; journey_date: Date; due_date: Date; booking_person_mobile: string | null;
  payable: bigint; collected: bigint };

/** Bookings with money still owed whose effective due date is in [from, to]. */
async function dueBookings(owner: string, from: string, to: string) {
  const rows = await getPrisma().$queryRaw<DueRow[]>`
    SELECT b.id, b.packager_id, p.name AS packager_name, b.boarding_station, b.destination_station,
      b.journey_date, coalesce(b.payment_due_date, b.journey_date) AS due_date, b.booking_person_mobile,
      b.ticket_price_paise + b.service_charge_paise AS payable, coalesce(entries.collected, 0)::bigint AS collected
    FROM app.bookings b
    JOIN app.packagers p ON p.id = b.packager_id AND p.owner_id = b.owner_id
    LEFT JOIN (
      SELECT booking_id, sum(CASE WHEN entry_type IN ('receipt', 'collection_adjustment_increase')
        THEN amount_paise ELSE -amount_paise END) AS collected
      FROM app.customer_fund_entries WHERE owner_id = ${owner}::uuid
      GROUP BY booking_id
    ) entries ON entries.booking_id = b.id
    WHERE b.owner_id = ${owner}::uuid
      AND coalesce(b.payment_due_date, b.journey_date) BETWEEN ${from}::date AND ${to}::date
      AND b.ticket_price_paise + b.service_charge_paise > coalesce(entries.collected, 0)
    ORDER BY due_date, p.name, b.id
    LIMIT 500`;
  const items = rows.map((row) => ({ booking_id: row.id, packager_id: row.packager_id,
    packager_name: row.packager_name, boarding_station: row.boarding_station,
    destination_station: row.destination_station,
    journey_date: row.journey_date.toISOString().slice(0, 10),
    due_date: row.due_date.toISOString().slice(0, 10),
    booking_person_mobile: row.booking_person_mobile,
    balance_due_paise: safeMoney(BigInt(row.payable) - BigInt(row.collected)) }));
  return { total_due_paise: items.reduce((total, item) => total + item.balance_due_paise, 0), items };
}

router.get('/agenda', async (request, response, next) => {
  try {
    const query = agendaQuery.parse(request.query);
    const owner = ownerId(response);
    const today = query.date ?? businessDate();
    const tomorrow = addDays(today, 1);
    const journeys = (date: string) => getPrisma().bookingLeg.findMany({
      where: { ownerId: owner, journeyDate: dateOnly(date), ticketStatus: { not: 'cancelled' } },
      include: legInclude, orderBy: [{ bookingId: 'asc' }, { sequence: 'asc' }], take: 500 });
    const [todayLegs, tomorrowLegs, dueToday, overdue] = await Promise.all([
      journeys(today), journeys(tomorrow),
      dueBookings(owner, today, today), dueBookings(owner, '0001-01-01', addDays(today, -1)),
    ]);
    response.json({ date: today, tomorrow,
      today_journeys: todayLegs.map(trackedLegJson),
      tomorrow_journeys: tomorrowLegs.map(trackedLegJson),
      payments_due_today: dueToday, overdue_payments: overdue });
  } catch (error) { next(error); }
});

type PendingRow = { id: string; name: string; phone: string | null; credit_limit_paise: bigint | null;
  booking_count: bigint; payable: bigint; collected: bigint; overdue: bigint; oldest_due_date: Date | null };

router.get('/finance/pending-agencies', async (request, response, next) => {
  try {
    const query = pendingQuery.parse(request.query);
    const owner = ownerId(response);
    const today = query.date ?? businessDate();
    const rows = await getPrisma().$queryRaw<PendingRow[]>`
      SELECT p.id, p.name, p.phone, p.credit_limit_paise,
        count(b.id)::bigint AS booking_count,
        coalesce(sum(b.payable), 0)::bigint AS payable,
        coalesce(sum(b.collected), 0)::bigint AS collected,
        coalesce(sum(CASE WHEN b.due_date < ${today}::date THEN greatest(b.payable - b.collected, 0) END), 0)::bigint AS overdue,
        min(CASE WHEN b.payable > b.collected THEN b.due_date END) AS oldest_due_date
      FROM app.packagers p
      LEFT JOIN (
        SELECT bk.id, bk.packager_id, coalesce(bk.payment_due_date, bk.journey_date) AS due_date,
          bk.ticket_price_paise + bk.service_charge_paise AS payable,
          coalesce(entries.collected, 0) AS collected
        FROM app.bookings bk
        LEFT JOIN (
          SELECT booking_id, sum(CASE WHEN entry_type IN ('receipt', 'collection_adjustment_increase')
            THEN amount_paise ELSE -amount_paise END) AS collected
          FROM app.customer_fund_entries WHERE owner_id = ${owner}::uuid
          GROUP BY booking_id
        ) entries ON entries.booking_id = bk.id
        WHERE bk.owner_id = ${owner}::uuid
      ) b ON b.packager_id = p.id
      WHERE p.owner_id = ${owner}::uuid AND NOT p.is_archived
      GROUP BY p.id, p.name, p.phone, p.credit_limit_paise`;
    const items = rows.map((row) => {
      const netDue = BigInt(row.payable) - BigInt(row.collected);
      const limit = row.credit_limit_paise === null ? null : BigInt(row.credit_limit_paise);
      return { packager_id: row.id, name: row.name, phone: row.phone,
        booking_count: safeMoney(BigInt(row.booking_count)),
        total_payable_paise: safeMoney(BigInt(row.payable)),
        collected_paise: safeMoney(BigInt(row.collected)),
        net_due_paise: safeMoney(netDue > 0n ? netDue : 0n),
        advance_credit_paise: safeMoney(netDue < 0n ? -netDue : 0n),
        overdue_paise: safeMoney(BigInt(row.overdue)),
        oldest_due_date: row.oldest_due_date?.toISOString().slice(0, 10) ?? null,
        credit_limit_paise: limit === null ? null : safeMoney(limit),
        available_credit_paise: limit === null ? null : safeMoney(limit - netDue),
        over_limit: limit !== null && netDue > limit };
    }).filter((item) => query.include_settled === 'true' || item.net_due_paise > 0)
      .sort((a, b) => b.net_due_paise - a.net_due_paise || a.name.localeCompare(b.name));
    response.json({ date: today, items,
      totals: { net_due_paise: items.reduce((total, item) => total + item.net_due_paise, 0),
        overdue_paise: items.reduce((total, item) => total + item.overdue_paise, 0),
        over_limit_count: items.filter((item) => item.over_limit).length } });
  } catch (error) { next(error); }
});

export { router as trackerRouter };
