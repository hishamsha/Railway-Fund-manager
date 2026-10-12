import { Router } from 'express';
import { authenticate } from '../auth/routes.js';
import { getPrisma } from '../database/prisma.js';

const router = Router();
router.use(authenticate);

function safeMoney(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error('Dashboard amount exceeds JSON integer range');
  return amount;
}

router.get('/', async (_request, response, next) => {
  try {
    const ownerId = response.locals.auth.userId as string;
    const db = getPrisma();
    const [totals, bookings, wallet, packagerCount] = await Promise.all([
      db.$queryRaw<Array<{ booking_count: bigint; payable: bigint; service_charge: bigint; collected: bigint;
        deducted: bigint; fund_balance: bigint; due: bigint; credit: bigint }>>`
        SELECT count(*)::bigint AS booking_count,
          coalesce(sum(payable), 0)::bigint AS payable,
          coalesce(sum(payable - ticket_price), 0)::bigint AS service_charge,
          coalesce(sum(collected), 0)::bigint AS collected,
          coalesce(sum(deducted), 0)::bigint AS deducted,
          coalesce(sum(ticket_price - deducted), 0)::bigint AS fund_balance,
          coalesce(sum(greatest(payable - collected, 0)), 0)::bigint AS due,
          coalesce(sum(greatest(collected - payable, 0)), 0)::bigint AS credit
        FROM (
          SELECT b.ticket_price_paise AS ticket_price,
            b.ticket_price_paise + b.service_charge_paise AS payable,
            coalesce(entries.collected, 0) AS collected,
            b.recorded_wallet_deduction_paise + coalesce(wallet_spend.deducted, 0)
              + coalesce(extra_deductions.deducted, 0) AS deducted
          FROM app.bookings b
          LEFT JOIN (
            SELECT booking_id, sum(CASE WHEN entry_type IN ('receipt', 'collection_adjustment_increase')
              THEN amount_paise ELSE -amount_paise END) AS collected
            FROM app.customer_fund_entries WHERE owner_id = ${ownerId}::uuid
            GROUP BY booking_id
          ) entries ON entries.booking_id = b.id
          LEFT JOIN (
            SELECT booking_id, sum(CASE
              WHEN entry_type = 'booking_debit' THEN amount_paise
              WHEN entry_type IN ('wallet_refund', 'debit_reversal') THEN -amount_paise
              ELSE 0 END) AS deducted
            FROM app.wallet_entries WHERE owner_id = ${ownerId}::uuid AND booking_id IS NOT NULL
            GROUP BY booking_id
          ) wallet_spend ON wallet_spend.booking_id = b.id
          LEFT JOIN (
            SELECT booking_id, sum(CASE WHEN entry_type = 'deduction_adjustment_decrease'
              THEN -amount_paise ELSE amount_paise END) AS deducted
            FROM app.booking_deduction_entries WHERE owner_id = ${ownerId}::uuid
            GROUP BY booking_id
          ) extra_deductions ON extra_deductions.booking_id = b.id
          WHERE b.owner_id = ${ownerId}::uuid
        ) balances`,
      db.booking.findMany({ where: { ownerId }, select: {
        id: true, packagerId: true, boardingStation: true, destinationStation: true,
        journeyDate: true, trainIdentifier: true, ticketPricePaise: true,
        serviceChargePaise: true, recordedWalletDeductionPaise: true, createdAt: true,
      }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 5 }),
      db.wallet.aggregate({ where: { ownerId, isActive: true },
        _sum: { currentBalancePaise: true }, _count: { id: true } }),
      db.packager.count({ where: { ownerId, isArchived: false } }),
    ]);
    const [customer, walletSpend, extraDeductions] = await Promise.all([
      db.customerFundEntry.groupBy({ by: ['bookingId', 'entryType'],
        where: { ownerId, bookingId: { in: bookings.map((booking) => booking.id) } },
        _sum: { amountPaise: true } }),
      db.walletEntry.groupBy({ by: ['bookingId', 'entryType'],
        where: { ownerId, bookingId: { in: bookings.map((booking) => booking.id) } },
        _sum: { amountPaise: true } }),
      db.bookingDeductionEntry.groupBy({ by: ['bookingId', 'entryType'],
        where: { ownerId, bookingId: { in: bookings.map((booking) => booking.id) } },
        _sum: { amountPaise: true } }),
    ]);
    const collectedByBooking = new Map<string, bigint>();
    for (const entry of customer) {
      const signed = entry.entryType === 'receipt' || entry.entryType === 'collection_adjustment_increase' ? 1n : -1n;
      collectedByBooking.set(entry.bookingId,
        (collectedByBooking.get(entry.bookingId) ?? 0n) + signed * (entry._sum.amountPaise ?? 0n));
    }
    const deductedByBooking = new Map<string, bigint>();
    for (const entry of walletSpend) {
      if (!entry.bookingId) continue;
      const signed = entry.entryType === 'booking_debit' ? 1n :
        entry.entryType === 'wallet_refund' || entry.entryType === 'debit_reversal' ? -1n : 0n;
      deductedByBooking.set(entry.bookingId,
        (deductedByBooking.get(entry.bookingId) ?? 0n) + signed * (entry._sum.amountPaise ?? 0n));
    }
    for (const entry of extraDeductions) {
      deductedByBooking.set(entry.bookingId,
        (deductedByBooking.get(entry.bookingId) ?? 0n) +
        (entry.entryType === 'deduction_adjustment_decrease' ? -1n : 1n) * (entry._sum.amountPaise ?? 0n));
    }
    const total = totals[0]!;
    response.json({
      booking_count: safeMoney(total.booking_count), packager_count: packagerCount,
      wallet_count: wallet._count.id,
      total_payable_paise: safeMoney(total.payable),
      service_charge_paise: safeMoney(total.service_charge),
      collected_paise: safeMoney(total.collected),
      wallet_deducted_paise: safeMoney(total.deducted),
      fund_balance_paise: safeMoney(total.fund_balance),
      balance_due_paise: safeMoney(total.due),
      advance_credit_paise: safeMoney(total.credit),
      wallet_balance_paise: safeMoney(wallet._sum.currentBalancePaise ?? 0n),
      recent_bookings: bookings.map((booking) => {
        const total = booking.ticketPricePaise + booking.serviceChargePaise;
        const received = collectedByBooking.get(booking.id) ?? 0n;
        const deducted = booking.recordedWalletDeductionPaise + (deductedByBooking.get(booking.id) ?? 0n);
        const signed = total - received;
        return { id: booking.id, packager_id: booking.packagerId,
          boarding_station: booking.boardingStation,
          destination_station: booking.destinationStation,
          journey_date: booking.journeyDate.toISOString().slice(0, 10),
          train_identifier: booking.trainIdentifier,
          total_payable_paise: safeMoney(total),
          collected_paise: safeMoney(received),
          wallet_deducted_paise: safeMoney(deducted),
          fund_balance_paise: safeMoney(booking.ticketPricePaise - deducted),
          balance_due_paise: safeMoney(signed > 0n ? signed : 0n),
          advance_credit_paise: safeMoney(signed < 0n ? -signed : 0n) };
      }),
    });
  } catch (error) { next(error); }
});

export { router as dashboardRouter };
