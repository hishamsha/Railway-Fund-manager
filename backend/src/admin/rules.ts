// Pure booking rules shared by the Phase 1 admin routes. Nothing here touches
// the database so each rule is unit tested directly.

export const ticketTypes = ['direct', 'connected'] as const;
export type TicketType = typeof ticketTypes[number];
export const ticketStatuses = ['requested', 'booked', 'confirmed', 'waitlisted',
  'rac', 'cancelled', 'travelled'] as const;
export type TicketStatus = typeof ticketStatuses[number];

const businessTimeZone = 'Asia/Kolkata';
const dayMs = 86_400_000;

/** Calendar date (YYYY-MM-DD) in India for the given instant. */
export function businessDate(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: businessTimeZone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * dayMs).toISOString().slice(0, 10);
}

export function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export type ChargeRule = { packagerId: string | null; ticketType: string; chargePaise: bigint };

/** Packager-specific rule first, then the owner's default, else no charge. */
export function pickServiceCharge(rules: ChargeRule[], packagerId: string,
  ticketType: TicketType): { charge_paise: bigint; source: 'packager' | 'default' | 'none' } {
  const own = rules.find((rule) => rule.packagerId === packagerId && rule.ticketType === ticketType);
  if (own) return { charge_paise: own.chargePaise, source: 'packager' };
  const fallback = rules.find((rule) => rule.packagerId === null && rule.ticketType === ticketType);
  if (fallback) return { charge_paise: fallback.chargePaise, source: 'default' };
  return { charge_paise: 0n, source: 'none' };
}

export type LegInput = { boarding_station: string; destination_station: string;
  journey_date: string; train_identifier: string; fare_paise: number };

export type DerivedRoute = { boarding_station: string; destination_station: string;
  journey_date: string; train_identifier: string; ticket_price_paise: number; ticket_type: TicketType };

/**
 * Booking-level fields derived from its legs. Returns an error message when
 * the legs cannot form one booking.
 */
export function deriveRoute(legs: LegInput[]): DerivedRoute | { error: string } {
  const first = legs[0];
  const last = legs.at(-1);
  if (!first || !last) return { error: 'At least one leg is required' };
  for (const [index, leg] of legs.entries()) {
    if (leg.boarding_station.toLowerCase() === leg.destination_station.toLowerCase()) {
      return { error: `Leg ${index + 1} destination must differ from boarding` };
    }
    const previous = legs[index - 1];
    if (previous && leg.journey_date < previous.journey_date) {
      return { error: `Leg ${index + 1} cannot travel before leg ${index}` };
    }
  }
  if (first.boarding_station.toLowerCase() === last.destination_station.toLowerCase()) {
    return { error: 'A return journey must be booked as two bookings' };
  }
  const trains = [...new Set(legs.map((leg) => leg.train_identifier))].join(' / ');
  return {
    boarding_station: first.boarding_station,
    destination_station: last.destination_station,
    journey_date: first.journey_date,
    train_identifier: trains.length > 160 ? `${trains.slice(0, 157)}...` : trains,
    ticket_price_paise: legs.reduce((total, leg) => total + leg.fare_paise, 0),
    ticket_type: legs.length > 1 ? 'connected' : 'direct',
  };
}

/**
 * Whether a new booking keeps the packager inside its credit limit. Credit is
 * the packager's net amount owed after this booking and its initial payment.
 */
export function creditCheck(limitPaise: bigint | null, netDuePaise: bigint,
  newPayablePaise: bigint, initialCollectedPaise: bigint) {
  const projected = netDuePaise + newPayablePaise - initialCollectedPaise;
  return { projected_due_paise: projected,
    allowed: limitPaise === null || projected <= limitPaise };
}
