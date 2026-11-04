import type { Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../middleware/api-error.js';
import { canTransition, journeyRequestFrom, type JourneyRequestAction } from '../admin/rules.js';

type RequestRow = { id: string; boardingStation: string; destinationStation: string; journeyDate: Date;
  trainIdentifier: string | null; ticketType: string; passengerCount: number; agencyNote: string | null;
  status: string; quotedTicketPricePaise: bigint | null; quotedServiceChargePaise: bigint | null;
  quoteNote: string | null; quotedAt: Date | null; declineReason: string | null; bookingId: string | null;
  createdAt: Date; updatedAt: Date };

/** Fields an agency may see about its own request. */
export function journeyRequestJson(request: RequestRow) {
  const quoted = request.quotedTicketPricePaise !== null && request.quotedServiceChargePaise !== null;
  return { id: request.id, boarding_station: request.boardingStation,
    destination_station: request.destinationStation,
    journey_date: request.journeyDate.toISOString().slice(0, 10),
    train_identifier: request.trainIdentifier, ticket_type: request.ticketType,
    passenger_count: request.passengerCount, agency_note: request.agencyNote, status: request.status,
    quote: quoted ? { ticket_price_paise: Number(request.quotedTicketPricePaise),
      service_charge_paise: Number(request.quotedServiceChargePaise),
      total_paise: Number(request.quotedTicketPricePaise! + request.quotedServiceChargePaise!),
      note: request.quoteNote, quoted_at: request.quotedAt?.toISOString() ?? null } : null,
    decline_reason: request.declineReason, booking_id: request.bookingId,
    created_at: request.createdAt.toISOString(), updated_at: request.updatedAt.toISOString() };
}

type Scope = { id: string; ownerId: string; packagerId?: string };

/**
 * Moves a request to a new state only if it is still in a state the action may
 * start from, so two people acting at once cannot both succeed. `guard` adds
 * conditions the row must also meet, such as the quote the agency agreed to.
 */
export async function transitionRequest(tx: Prisma.TransactionClient, scope: Scope,
  action: JourneyRequestAction, data: Prisma.JourneyRequestUncheckedUpdateManyInput,
  guard: Prisma.JourneyRequestWhereInput = {}) {
  const moved = await tx.journeyRequest.updateMany({
    where: { ...scope, ...guard, status: { in: journeyRequestFrom[action] } }, data });
  if (moved.count !== 1) {
    const current = await tx.journeyRequest.findFirst({ where: scope, select: { status: true } });
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    if (canTransition(action, current.status)) {
      throw new ApiError(409, 'QUOTE_CHANGED', 'The quote changed. Reload it before accepting');
    }
    throw new ApiError(409, 'REQUEST_STATE_CONFLICT', `A ${current.status} request cannot be changed this way`);
  }
  return tx.journeyRequest.findFirstOrThrow({ where: scope });
}
