import { describe, expect, it } from 'vitest';
import { addDays, businessDate, canTransition, creditCheck, deriveRoute, pickServiceCharge } from '../src/admin/rules.js';

const leg = (from: string, to: string, date: string, train: string, fare: number) => ({
  boarding_station: from, destination_station: to, journey_date: date, train_identifier: train, fare_paise: fare });

describe('business dates', () => {
  it('uses the India calendar day', () => {
    expect(businessDate(new Date('2026-11-01T18:29:59Z'))).toBe('2026-11-01');
    expect(businessDate(new Date('2026-11-01T18:30:00Z'))).toBe('2026-11-02');
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('service charge rules', () => {
  const rules = [
    { packagerId: null, ticketType: 'direct', chargePaise: 5000n },
    { packagerId: null, ticketType: 'connected', chargePaise: 8000n },
    { packagerId: 'agency-a', ticketType: 'connected', chargePaise: 6000n },
  ];
  it('prefers the packager rule, then the default, then zero', () => {
    expect(pickServiceCharge(rules, 'agency-a', 'connected')).toEqual({ charge_paise: 6000n, source: 'packager' });
    expect(pickServiceCharge(rules, 'agency-a', 'direct')).toEqual({ charge_paise: 5000n, source: 'default' });
    expect(pickServiceCharge([], 'agency-a', 'direct')).toEqual({ charge_paise: 0n, source: 'none' });
  });
});

describe('route derivation', () => {
  it('derives a connected booking from its legs', () => {
    expect(deriveRoute([
      leg('Kozhikode', 'Ernakulam', '2026-11-10', '16346', 32000),
      leg('Ernakulam', 'Chennai', '2026-11-10', '12624', 85000),
    ])).toEqual({ boarding_station: 'Kozhikode', destination_station: 'Chennai',
      journey_date: '2026-11-10', train_identifier: '16346 / 12624',
      ticket_price_paise: 117000, ticket_type: 'connected' });
  });
  it('treats one leg as direct', () => {
    expect(deriveRoute([leg('A', 'B', '2026-11-10', '1', 100)])).toMatchObject({ ticket_type: 'direct' });
  });
  it('rejects legs out of date order and return journeys', () => {
    expect(deriveRoute([leg('A', 'B', '2026-11-11', '1', 100), leg('B', 'C', '2026-11-10', '2', 100)]))
      .toEqual({ error: 'Leg 2 cannot travel before leg 1' });
    expect(deriveRoute([leg('A', 'B', '2026-11-10', '1', 100), leg('B', 'a', '2026-11-12', '2', 100)]))
      .toEqual({ error: 'A return journey must be booked as two bookings' });
    expect(deriveRoute([])).toEqual({ error: 'At least one leg is required' });
  });
});

describe('credit limit', () => {
  it('allows bookings up to the limit and any amount without one', () => {
    expect(creditCheck(10000n, 4000n, 7000n, 1000n)).toEqual({ projected_due_paise: 10000n, allowed: true });
    expect(creditCheck(10000n, 4000n, 7000n, 0n)).toEqual({ projected_due_paise: 11000n, allowed: false });
    expect(creditCheck(null, 4000n, 7000n, 0n).allowed).toBe(true);
  });
  it('lets advance credit absorb a new booking', () => {
    expect(creditCheck(0n, -5000n, 5000n, 0n).allowed).toBe(true);
  });
});

describe('journey request transitions', () => {
  it('allows only the expected moves', () => {
    expect(canTransition('quote', 'pending')).toBe(true);
    expect(canTransition('quote', 'quoted')).toBe(true);
    expect(canTransition('quote', 'accepted')).toBe(false);
    expect(canTransition('accept', 'quoted')).toBe(true);
    expect(canTransition('accept', 'pending')).toBe(false);
    expect(canTransition('book', 'accepted')).toBe(true);
  });
  it('treats declined, cancelled and booked as final', () => {
    for (const status of ['declined', 'cancelled', 'booked']) {
      for (const action of ['quote', 'accept', 'decline', 'cancel', 'book'] as const) {
        expect(canTransition(action, status)).toBe(false);
      }
    }
  });
});
