-- Append-only standalone deductions made after booking creation.
CREATE TABLE "app"."booking_deduction_entries" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "amount_paise" BIGINT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "operation_request_id" UUID NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_deduction_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_deduction_entries_amount_check"
    CHECK ("amount_paise" BETWEEN 1 AND 1000000000000)
);

CREATE INDEX "booking_deduction_entries_owner_booking_occurred_idx"
  ON "app"."booking_deduction_entries" ("owner_id", "booking_id", "occurred_at");

ALTER TABLE "app"."booking_deduction_entries"
  ADD CONSTRAINT "booking_deduction_entries_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "app"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."booking_deduction_entries"
  ADD CONSTRAINT "booking_deduction_entries_owner_booking_fkey"
  FOREIGN KEY ("owner_id", "booking_id") REFERENCES "app"."bookings"("owner_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."booking_deduction_entries"
  ADD CONSTRAINT "booking_deduction_entries_owner_operation_fkey"
  FOREIGN KEY ("owner_id", "operation_request_id") REFERENCES "app"."operation_requests"("owner_id", "request_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER booking_deduction_entries_immutable
  BEFORE UPDATE OR DELETE ON "app"."booking_deduction_entries"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_finance_entry_change"();

GRANT SELECT, INSERT ON "app"."booking_deduction_entries" TO app_runtime;
