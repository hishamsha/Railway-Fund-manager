-- A cancelled ticket stops being billed at its fare; only an optional
-- cancellation charge remains. bookings.ticket_price_paise stays the amount
-- billed for tickets, so every report that reads it stays correct:
-- the sum over legs of (cancelled ? cancellation_charge_paise : fare_paise).
ALTER TABLE "app"."booking_legs" ADD COLUMN "cancellation_charge_paise" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "app"."booking_legs" ADD CONSTRAINT "booking_legs_cancellation_charge_check"
  CHECK (cancellation_charge_paise BETWEEN 0 AND 1000000000000
    AND (cancellation_charge_paise = 0 OR ticket_status = 'cancelled'));

-- A fully cancelled booking with no charge bills nothing for tickets.
ALTER TABLE "app"."bookings" DROP CONSTRAINT "bookings_money_check";
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_money_check"
  CHECK (ticket_price_paise BETWEEN 0 AND 1000000000000
    AND service_charge_paise BETWEEN 0 AND 1000000000000);

-- Tickets already cancelled stop counting too.
UPDATE "app"."bookings" b
SET ticket_price_paise = billed.total, updated_at = now()
FROM (
  SELECT booking_id, sum(CASE WHEN ticket_status = 'cancelled' THEN 0 ELSE fare_paise END) AS total
  FROM "app"."booking_legs"
  GROUP BY booking_id
  HAVING bool_or(ticket_status = 'cancelled')
) billed
WHERE billed.booking_id = b.id;
