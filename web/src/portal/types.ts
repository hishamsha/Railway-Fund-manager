import type { Quote } from '../api';

export type Summary = { agency: { id: string; name: string; phone: string | null }; date: string; booking_count: number;
  total_payable_paise: number; collected_paise: number; net_due_paise: number; advance_credit_paise: number; overdue_paise: number;
  oldest_due_date: string | null; credit_limit_paise: number | null; available_credit_paise: number | null;
  upcoming_ticket_count: number; open_request_count: number };
export type PortalLeg = { id: string; sequence: number; boarding_station: string; destination_station: string; journey_date: string;
  train_identifier: string; fare_paise: number; pnr: string | null; ticket_status: string; cancellation_charge_paise: number };
export type PortalJourney = PortalLeg & { booking_id: string };
export type PortalBooking = { id: string; boarding_station: string; destination_station: string; journey_date: string;
  train_identifier: string; ticket_type: string; booking_person_mobile: string | null; due_date: string; ticket_price_paise: number;
  service_charge_paise: number; total_payable_paise: number; collected_paise: number; balance_due_paise: number;
  advance_credit_paise: number; legs: PortalLeg[] };
export type PortalPayment = { id: string; booking_id: string; boarding_station: string; destination_station: string; journey_date: string;
  entry_type: string; method: string | null; amount_paise: number; occurred_at: string };
export type PortalRequest = { id: string; boarding_station: string; destination_station: string; journey_date: string;
  train_identifier: string | null; ticket_type: string; passenger_count: number; agency_note: string | null; status: string;
  quote: Quote | null; decline_reason: string | null; booking_id: string | null; created_at: string };
