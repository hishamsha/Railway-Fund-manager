-- Phase 1 admin: ticket source accounts, per-leg fares and ticket status,
-- service charge rules by packager and ticket type, credit limits and
-- payment due dates. Money stays in integer paise.

-- Personal IRCTC IDs and agent portals tickets are bought from. Only a login
-- name is stored; passwords never enter this system.
CREATE TABLE "app"."booking_accounts" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "login_id" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_accounts_check"
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 160
        AND kind IN ('personal_id', 'agent_portal')
        AND (login_id IS NULL OR char_length(btrim(login_id)) BETWEEN 1 AND 160))
);
CREATE INDEX "booking_accounts_owner_id_is_active_idx" ON "app"."booking_accounts"("owner_id", "is_active");
ALTER TABLE "app"."booking_accounts" ADD CONSTRAINT "booking_accounts_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "app"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NULL means no credit limit is enforced for the packager.
ALTER TABLE "app"."packagers" ADD COLUMN "credit_limit_paise" BIGINT;
ALTER TABLE "app"."packagers" ADD CONSTRAINT "packagers_credit_limit_check"
  CHECK (credit_limit_paise IS NULL OR credit_limit_paise BETWEEN 0 AND 1000000000000);

-- A NULL packager_id is the owner's default charge for that ticket type.
CREATE TABLE "app"."service_charge_rules" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "packager_id" UUID,
    "ticket_type" TEXT NOT NULL,
    "charge_paise" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_charge_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_charge_rules_check"
      CHECK (ticket_type IN ('direct', 'connected')
        AND charge_paise BETWEEN 0 AND 1000000000000)
);
CREATE INDEX "service_charge_rules_owner_id_packager_id_idx" ON "app"."service_charge_rules"("owner_id", "packager_id");
CREATE UNIQUE INDEX "service_charge_rules_owner_packager_type_key"
  ON "app"."service_charge_rules"("owner_id", "packager_id", "ticket_type") NULLS NOT DISTINCT;
ALTER TABLE "app"."service_charge_rules" ADD CONSTRAINT "service_charge_rules_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "app"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."service_charge_rules" ADD CONSTRAINT "service_charge_rules_packager_id_fkey"
  FOREIGN KEY ("packager_id") REFERENCES "app"."packagers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Effective payment due date is coalesce(payment_due_date, journey_date).
ALTER TABLE "app"."bookings" ADD COLUMN "ticket_type" TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE "app"."bookings" ADD COLUMN "payment_due_date" DATE;
ALTER TABLE "app"."bookings" ADD CONSTRAINT "bookings_ticket_type_check"
  CHECK (ticket_type IN ('direct', 'connected'));

-- One row per train segment. The booking keeps the derived route, first
-- journey date and total ticket price so existing reports stay correct.
CREATE TABLE "app"."booking_legs" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "boarding_station" TEXT NOT NULL,
    "destination_station" TEXT NOT NULL,
    "journey_date" DATE NOT NULL,
    "train_identifier" TEXT NOT NULL,
    "fare_paise" BIGINT NOT NULL,
    "booking_account_id" UUID,
    "pnr" TEXT,
    "ticket_status" TEXT NOT NULL DEFAULT 'booked',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_legs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_legs_check"
      CHECK (sequence BETWEEN 1 AND 20
        AND char_length(btrim(boarding_station)) BETWEEN 1 AND 160
        AND char_length(btrim(destination_station)) BETWEEN 1 AND 160
        AND lower(btrim(boarding_station)) <> lower(btrim(destination_station))
        AND char_length(btrim(train_identifier)) BETWEEN 1 AND 160
        AND fare_paise BETWEEN 1 AND 1000000000000
        AND (pnr IS NULL OR pnr ~ '^[0-9A-Za-z]{6,20}$')
        AND ticket_status IN ('requested', 'booked', 'confirmed', 'waitlisted', 'rac', 'cancelled', 'travelled'))
);
CREATE UNIQUE INDEX "booking_legs_booking_id_sequence_key" ON "app"."booking_legs"("booking_id", "sequence");
CREATE INDEX "booking_legs_owner_id_journey_date_idx" ON "app"."booking_legs"("owner_id", "journey_date");
CREATE INDEX "booking_legs_owner_id_booking_account_id_idx" ON "app"."booking_legs"("owner_id", "booking_account_id");
CREATE INDEX "booking_legs_owner_id_ticket_status_idx" ON "app"."booking_legs"("owner_id", "ticket_status");
ALTER TABLE "app"."booking_legs" ADD CONSTRAINT "booking_legs_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "app"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."booking_legs" ADD CONSTRAINT "booking_legs_owner_id_booking_id_fkey"
  FOREIGN KEY ("owner_id", "booking_id") REFERENCES "app"."bookings"("owner_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."booking_legs" ADD CONSTRAINT "booking_legs_booking_account_id_fkey"
  FOREIGN KEY ("booking_account_id") REFERENCES "app"."booking_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing bookings become single-leg direct bookings.
INSERT INTO "app"."booking_legs" ("id", "owner_id", "booking_id", "sequence",
  "boarding_station", "destination_station", "journey_date", "train_identifier",
  "fare_paise", "ticket_status", "created_at", "updated_at")
SELECT gen_random_uuid(), owner_id, id, 1, boarding_station, destination_station,
  journey_date, train_identifier, ticket_price_paise, 'booked', created_at, now()
FROM "app"."bookings";
