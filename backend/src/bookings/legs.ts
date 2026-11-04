import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../middleware/api-error.js';
import { dateOnly, deriveRoute, pickServiceCharge, ticketStatuses, type DerivedRoute,
  type LegInput, type TicketType } from '../admin/rules.js';

const station = z.string().trim().min(1).max(160);
export const pnr = z.string().trim().regex(/^[0-9A-Za-z]{6,20}$/, 'PNR is 6–20 letters or digits');
export const ticketStatus = z.enum(ticketStatuses);
export const legBody = z.strictObject({
  boarding_station: station,
  destination_station: station,
  journey_date: z.iso.date(),
  train_identifier: z.string().trim().min(1).max(160),
  fare_paise: z.number().int().safe().min(1).max(1_000_000_000_000),
  booking_account_id: z.uuid().nullable().optional(),
  pnr: pnr.nullable().optional(),
  ticket_status: ticketStatus.optional(),
  cancellation_charge_paise: z.number().int().safe().min(0).max(1_000_000_000_000).optional(),
}).refine((leg) => !leg.cancellation_charge_paise || leg.ticket_status === 'cancelled',
  { path: ['cancellation_charge_paise'], message: 'Only a cancelled ticket can have a cancellation charge' });
export const legsBody = z.array(legBody).min(1).max(20);
export type LegBody = z.infer<typeof legBody>;

type LegRow = { id: string; sequence: number; boardingStation: string; destinationStation: string;
  journeyDate: Date; trainIdentifier: string; farePaise: bigint; bookingAccountId: string | null;
  pnr: string | null; ticketStatus: string; cancellationChargePaise: bigint; updatedAt: Date };

export function legJson(leg: LegRow) {
  return { id: leg.id, sequence: leg.sequence,
    boarding_station: leg.boardingStation, destination_station: leg.destinationStation,
    journey_date: leg.journeyDate.toISOString().slice(0, 10),
    train_identifier: leg.trainIdentifier, fare_paise: Number(leg.farePaise),
    booking_account_id: leg.bookingAccountId, pnr: leg.pnr, ticket_status: leg.ticketStatus,
    cancellation_charge_paise: Number(leg.cancellationChargePaise),
    updated_at: leg.updatedAt.toISOString() };
}

/** Booking-level route, or a 422 explaining why the legs do not form one booking. */
export function routeFromLegs(legs: LegInput[]): DerivedRoute {
  const route = deriveRoute(legs);
  if ('error' in route) throw new ApiError(422, 'INVALID_LEGS', route.error);
  return route;
}

export function legRows(owner: string, bookingId: string, legs: LegBody[]) {
  return legs.map((leg, index) => ({ ownerId: owner, bookingId, sequence: index + 1,
    boardingStation: leg.boarding_station, destinationStation: leg.destination_station,
    journeyDate: dateOnly(leg.journey_date), trainIdentifier: leg.train_identifier,
    farePaise: BigInt(leg.fare_paise), bookingAccountId: leg.booking_account_id ?? null,
    pnr: leg.pnr ?? null, ticketStatus: leg.ticket_status ?? 'booked',
    cancellationChargePaise: BigInt(leg.cancellation_charge_paise ?? 0) }));
}

/** Every referenced booking account must be the owner's and still active. */
export async function requireAccounts(tx: Prisma.TransactionClient, owner: string,
  ids: Array<string | null | undefined>) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return;
  const found = await tx.bookingAccount.count({ where: { ownerId: owner, isActive: true, id: { in: wanted } } });
  if (found !== wanted.length) throw new ApiError(404, 'NOT_FOUND', 'Booking account not found');
}

export async function quoteServiceCharge(tx: Prisma.TransactionClient, owner: string,
  packagerId: string, ticketType: TicketType): Promise<bigint> {
  const rules = await tx.serviceChargeRule.findMany({ where: { ownerId: owner, ticketType,
    OR: [{ packagerId }, { packagerId: null }] } });
  return pickServiceCharge(rules, packagerId, ticketType).charge_paise;
}

/** Packager's total payable minus net collections across all its bookings. */
export async function packagerNetDue(tx: Prisma.TransactionClient, owner: string,
  packagerId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<Array<{ net_due: bigint }>>`
    SELECT coalesce(sum(b.ticket_price_paise + b.service_charge_paise
      - coalesce(entries.collected, 0)), 0)::bigint AS net_due
    FROM app.bookings b
    LEFT JOIN (
      SELECT booking_id, sum(CASE WHEN entry_type IN ('receipt', 'collection_adjustment_increase')
        THEN amount_paise ELSE -amount_paise END) AS collected
      FROM app.customer_fund_entries WHERE owner_id = ${owner}::uuid
      GROUP BY booking_id
    ) entries ON entries.booking_id = b.id
    WHERE b.owner_id = ${owner}::uuid AND b.packager_id = ${packagerId}::uuid`;
  return BigInt(rows[0]?.net_due ?? 0n);
}

export function rupees(paise: bigint): string {
  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  return `${negative ? '-' : ''}₹${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
