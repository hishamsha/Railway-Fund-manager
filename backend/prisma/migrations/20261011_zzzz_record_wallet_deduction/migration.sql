-- Record an external wallet deduction on a booking without requiring an app wallet.
-- Existing wallet ledger entries remain intact for historical bookings.
ALTER TABLE "app"."bookings"
  ADD COLUMN "recorded_wallet_deduction_paise" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "app"."bookings"
  ADD CONSTRAINT "bookings_recorded_wallet_deduction_check"
  CHECK ("recorded_wallet_deduction_paise" BETWEEN 0 AND 1000000000000);
