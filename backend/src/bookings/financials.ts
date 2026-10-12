import { getPrisma } from '../database/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';

type BookingMoney = { id: string; ownerId: string; ticketPricePaise: bigint;
  serviceChargePaise: bigint; recordedWalletDeductionPaise: bigint };

export async function bookingFinancials(booking: BookingMoney,
  db: Prisma.TransactionClient = getPrisma()) {
  const [customer, wallet, recorded] = await Promise.all([
    db.customerFundEntry.groupBy({ by: ['entryType'], where: {
      ownerId: booking.ownerId, bookingId: booking.id,
    }, _sum: { amountPaise: true } }),
    db.walletEntry.groupBy({ by: ['entryType'], where: {
      ownerId: booking.ownerId, bookingId: booking.id,
    }, _sum: { amountPaise: true } }),
    db.bookingDeductionEntry.groupBy({ by: ['entryType'], where: {
      ownerId: booking.ownerId, bookingId: booking.id,
    }, _sum: { amountPaise: true } }),
  ]);
  const sum = (rows: Array<{ entryType: string; _sum: { amountPaise: bigint | null } }>, kind: string) =>
    rows.find((row) => row.entryType === kind)?._sum.amountPaise ?? 0n;
  const collected = sum(customer, 'receipt') + sum(customer, 'collection_adjustment_increase') -
    sum(customer, 'collection_adjustment_decrease') - sum(customer, 'refund') - sum(customer, 'reversal');
  const walletDeducted = booking.recordedWalletDeductionPaise +
    sum(recorded, 'booking_debit') - sum(recorded, 'deduction_adjustment_decrease') +
    sum(wallet, 'booking_debit') - sum(wallet, 'wallet_refund') - sum(wallet, 'debit_reversal');
  const payable = booking.ticketPricePaise + booking.serviceChargePaise;
  const signedBalance = payable - collected;
  return {
    ticket_price_paise: Number(booking.ticketPricePaise),
    service_charge_paise: Number(booking.serviceChargePaise),
    total_payable_paise: Number(payable),
    collected_paise: Number(collected),
    wallet_deducted_paise: Number(walletDeducted),
    fund_balance_paise: Number(booking.ticketPricePaise - walletDeducted),
    signed_balance_paise: Number(signedBalance),
    balance_due_paise: Number(signedBalance > 0n ? signedBalance : 0n),
    advance_credit_paise: Number(signedBalance < 0n ? -signedBalance : 0n),
  };
}
