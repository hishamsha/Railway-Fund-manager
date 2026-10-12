import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';
import { ApiError } from '../middleware/api-error.js';

const router = Router();
router.use(authenticate);
const querySchema = z.object({
  from_date: z.iso.date(), to_date: z.iso.date(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  packager_id: z.uuid().optional(),
  clock: z.enum(['created_at', 'journey_date']).default('created_at'),
});

function parsedQuery(query: object) {
  const value = querySchema.parse(query);
  const from = new Date(`${value.from_date}T00:00:00.000Z`);
  const until = new Date(`${value.to_date}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + 1);
  if (until <= from || (until.getTime() - from.getTime()) / 86_400_000 > 366) {
    throw new ApiError(422, 'INVALID_DATE_RANGE', 'Choose an inclusive range of at most 366 days');
  }
  return { ...value, from, until };
}
const bookingQuerySchema = querySchema.partial({ from_date: true, to_date: true });
function parsedBookingQuery(query: object) {
  const value = bookingQuerySchema.parse(query);
  if (value.from_date === undefined && value.to_date === undefined) {
    return { ...value, from: null, until: null };
  }
  if (value.from_date === undefined || value.to_date === undefined) {
    throw new ApiError(422, 'INVALID_DATE_RANGE', 'Provide both dates or neither');
  }
  return parsedQuery(query);
}
function safeMoney(value: bigint | null | undefined): number {
  const amount = Number(value ?? 0n);
  if (!Number.isSafeInteger(amount)) throw new ApiError(422, 'AMOUNT_LIMIT', 'Report amount exceeds JSON integer range');
  return amount;
}
function paging(limit: number, offset: number, count: number) {
  return count > offset + limit ? offset + limit : null;
}

router.get('/bookings', async (request, response, next) => {
  try {
    const query = parsedBookingQuery(request.query);
    const ownerId = response.locals.auth.userId as string;
    const where = { ownerId, ...(query.packager_id ? { packagerId: query.packager_id } : {}),
      ...(query.from && query.until && (query.clock === 'journey_date'
        ? { journeyDate: { gte: query.from, lt: query.until } }
        : { createdAt: { gte: query.from, lt: query.until } })) };
    const db = getPrisma();
    const [summary, items] = await Promise.all([
      db.booking.aggregate({ where, _count: { id: true },
        _sum: { ticketPricePaise: true, serviceChargePaise: true } }),
      db.booking.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.offset, take: query.limit, select: { id: true, packagerId: true,
          boardingStation: true, destinationStation: true, journeyDate: true,
          createdAt: true, trainIdentifier: true, bookingPersonMobile: true, ticketPricePaise: true,
          serviceChargePaise: true, recordedWalletDeductionPaise: true, notes: true,
          packager: { select: { name: true } } } }),
    ]);
    const price = summary._sum.ticketPricePaise ?? 0n;
    const fee = summary._sum.serviceChargePaise ?? 0n;
    const ids = items.map((item) => item.id);
    const [customer, wallet, deductions] = await Promise.all([
      db.customerFundEntry.groupBy({ by: ['bookingId', 'entryType'],
        where: { ownerId, bookingId: { in: ids } }, _sum: { amountPaise: true } }),
      db.walletEntry.groupBy({ by: ['bookingId', 'entryType'],
        where: { ownerId, bookingId: { in: ids } }, _sum: { amountPaise: true } }),
      db.bookingDeductionEntry.groupBy({ by: ['bookingId', 'entryType'],
        where: { ownerId, bookingId: { in: ids } }, _sum: { amountPaise: true } }),
    ]);
    const collected = new Map<string, bigint>();
    const deducted = new Map<string, bigint>();
    for (const entry of customer) {
      const sign = entry.entryType === 'receipt' || entry.entryType === 'collection_adjustment_increase' ? 1n : -1n;
      collected.set(entry.bookingId,
        (collected.get(entry.bookingId) ?? 0n) + sign * (entry._sum.amountPaise ?? 0n));
    }
    for (const entry of wallet) {
      if (!entry.bookingId) continue;
      const sign = entry.entryType === 'booking_debit' ? 1n :
        entry.entryType === 'wallet_refund' || entry.entryType === 'debit_reversal' ? -1n : 0n;
      deducted.set(entry.bookingId,
        (deducted.get(entry.bookingId) ?? 0n) + sign * (entry._sum.amountPaise ?? 0n));
    }
    for (const entry of deductions) {
      const sign = entry.entryType === 'deduction_adjustment_decrease' ? -1n : 1n;
      deducted.set(entry.bookingId,
        (deducted.get(entry.bookingId) ?? 0n) + sign * (entry._sum.amountPaise ?? 0n));
    }
    response.json({ clock: query.clock, from_date: query.from_date ?? null, to_date: query.to_date ?? null,
      summary: { booking_count: summary._count.id, ticket_price_paise: safeMoney(price),
        service_charge_paise: safeMoney(fee), total_payable_paise: safeMoney(price + fee) },
      items: items.map((item) => ({ id: item.id, packager_id: item.packagerId,
        packager_name: item.packager.name,
        boarding_station: item.boardingStation, destination_station: item.destinationStation,
        train_identifier: item.trainIdentifier, booking_person_mobile: item.bookingPersonMobile,
        journey_date: item.journeyDate.toISOString().slice(0, 10),
        created_at: item.createdAt.toISOString(), notes: item.notes,
        ticket_price_paise: safeMoney(item.ticketPricePaise),
        service_charge_paise: safeMoney(item.serviceChargePaise),
        total_payable_paise: safeMoney(item.ticketPricePaise + item.serviceChargePaise),
        collected_paise: safeMoney(collected.get(item.id)),
        wallet_deducted_paise: safeMoney(item.recordedWalletDeductionPaise + (deducted.get(item.id) ?? 0n)),
        fund_balance_paise: safeMoney(item.ticketPricePaise - item.recordedWalletDeductionPaise - (deducted.get(item.id) ?? 0n)),
        balance_due_paise: safeMoney((item.ticketPricePaise + item.serviceChargePaise - (collected.get(item.id) ?? 0n)) > 0n
          ? item.ticketPricePaise + item.serviceChargePaise - (collected.get(item.id) ?? 0n) : 0n),
        advance_credit_paise: safeMoney((collected.get(item.id) ?? 0n) > item.ticketPricePaise + item.serviceChargePaise
          ? (collected.get(item.id) ?? 0n) - item.ticketPricePaise - item.serviceChargePaise : 0n) })),
      next_offset: paging(query.limit, query.offset, summary._count.id) });
  } catch (error) { next(error); }
});

router.get('/collections', async (request, response, next) => {
  try {
    const query = parsedQuery(request.query);
    const ownerId = response.locals.auth.userId as string;
    const where = { ownerId, occurredAt: { gte: query.from, lt: query.until },
      ...(query.packager_id ? { booking: { packagerId: query.packager_id } } : {}) };
    const db = getPrisma();
    const [groups, count, items] = await Promise.all([
      db.customerFundEntry.groupBy({ by: ['entryType'], where, _sum: { amountPaise: true } }),
      db.customerFundEntry.count({ where }),
      db.customerFundEntry.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: query.offset, take: query.limit,
        include: { booking: { select: { packagerId: true } } } }),
    ]);
    const sum = (kind: string) => groups.find((row) => row.entryType === kind)?._sum.amountPaise ?? 0n;
    const received = sum('receipt');
    const returned = sum('refund');
    const reversed = sum('reversal');
    const increased = sum('collection_adjustment_increase');
    const decreased = sum('collection_adjustment_decrease');
    response.json({ clock: 'occurred_at', from_date: query.from_date, to_date: query.to_date,
      summary: { entry_count: count, receipts_paise: safeMoney(received),
        refunds_paise: safeMoney(returned), reversals_paise: safeMoney(reversed),
        adjustment_increase_paise: safeMoney(increased), adjustment_decrease_paise: safeMoney(decreased),
        net_collected_paise: safeMoney(received + increased - returned - reversed - decreased) },
      items: items.map((item) => ({ id: item.id, booking_id: item.bookingId,
        packager_id: item.booking.packagerId, entry_type: item.entryType,
        amount_paise: safeMoney(item.amountPaise), method: item.method,
        occurred_at: item.occurredAt.toISOString(),
        original_entry_id: item.reversalOfEntryId })),
      next_offset: paging(query.limit, query.offset, count) });
  } catch (error) { next(error); }
});

router.get('/wallets', async (request, response, next) => {
  try {
    const query = parsedQuery(request.query);
    const ownerId = response.locals.auth.userId as string;
    const where = { ownerId, occurredAt: { gte: query.from, lt: query.until },
      ...(query.packager_id ? { booking: { packagerId: query.packager_id } } : {}) };
    const db = getPrisma();
    const [groups, count, items] = await Promise.all([
      db.walletEntry.groupBy({ by: ['entryType'], where, _sum: { amountPaise: true } }),
      db.walletEntry.count({ where }),
      db.walletEntry.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: query.offset, take: query.limit,
        include: { booking: { select: { packagerId: true } } } }),
    ]);
    const sum = (kind: string) => groups.find((row) => row.entryType === kind)?._sum.amountPaise ?? 0n;
    const credits = sum('top_up') + sum('wallet_refund') + sum('debit_reversal')
      + sum('manual_adjustment_credit');
    const debits = sum('booking_debit') + sum('manual_adjustment_debit');
    response.json({ clock: 'occurred_at', from_date: query.from_date, to_date: query.to_date,
      summary: { entry_count: count, credits_paise: safeMoney(credits),
        debits_paise: safeMoney(debits), net_movement_paise: safeMoney(credits - debits),
        booking_spend_paise: safeMoney(sum('booking_debit') - sum('wallet_refund') - sum('debit_reversal')) },
      items: items.map((item) => ({ id: item.id, wallet_id: item.walletId,
        booking_id: item.bookingId, packager_id: item.booking?.packagerId ?? null,
        entry_type: item.entryType, amount_paise: safeMoney(item.amountPaise),
        occurred_at: item.occurredAt.toISOString(), original_entry_id: item.reversalOfEntryId })),
      next_offset: paging(query.limit, query.offset, count) });
  } catch (error) { next(error); }
});

export { router as reportRouter };
