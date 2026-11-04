-- Phase 2: agency logins limited to one packager, and journey requests agencies
-- send for the owner to quote and book. Existing users stay owners.
ALTER TABLE "app"."app_users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE "app"."app_users" ADD COLUMN "agency_owner_id" UUID;
ALTER TABLE "app"."app_users" ADD COLUMN "packager_id" UUID;
ALTER TABLE "app"."app_users" ADD CONSTRAINT "app_users_role_check"
  CHECK ((role = 'owner' AND agency_owner_id IS NULL AND packager_id IS NULL)
    OR (role = 'agency' AND agency_owner_id IS NOT NULL AND packager_id IS NOT NULL));
CREATE INDEX "app_users_agency_owner_id_packager_id_idx" ON "app"."app_users"("agency_owner_id", "packager_id");
-- The composite key makes it impossible to link a user to another owner's packager.
ALTER TABLE "app"."app_users" ADD CONSTRAINT "app_users_agency_owner_id_packager_id_fkey"
  FOREIGN KEY ("agency_owner_id", "packager_id") REFERENCES "app"."packagers"("owner_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "app"."journey_requests" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "packager_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "boarding_station" TEXT NOT NULL,
    "destination_station" TEXT NOT NULL,
    "journey_date" DATE NOT NULL,
    "train_identifier" TEXT,
    "ticket_type" TEXT NOT NULL DEFAULT 'direct',
    "passenger_count" INTEGER NOT NULL DEFAULT 1,
    "agency_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "quoted_ticket_price_paise" BIGINT,
    "quoted_service_charge_paise" BIGINT,
    "quote_note" TEXT,
    "quoted_at" TIMESTAMPTZ(6),
    "decline_reason" TEXT,
    "booking_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "journey_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journey_requests_route_check"
      CHECK (char_length(btrim(boarding_station)) BETWEEN 1 AND 160
        AND char_length(btrim(destination_station)) BETWEEN 1 AND 160
        AND lower(btrim(boarding_station)) <> lower(btrim(destination_station))
        AND (train_identifier IS NULL OR char_length(btrim(train_identifier)) BETWEEN 1 AND 160)
        AND ticket_type IN ('direct', 'connected')
        AND passenger_count BETWEEN 1 AND 500
        AND payload_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "journey_requests_state_check"
      CHECK (status IN ('pending', 'quoted', 'accepted', 'declined', 'cancelled', 'booked')
        AND (status = 'booked') = (booking_id IS NOT NULL)
        AND (status = 'declined') = (decline_reason IS NOT NULL)
        AND (quoted_ticket_price_paise IS NULL) = (quoted_service_charge_paise IS NULL)
        AND (quoted_ticket_price_paise IS NULL) = (quoted_at IS NULL)
        AND (status NOT IN ('quoted', 'accepted') OR quoted_ticket_price_paise IS NOT NULL)
        AND (quoted_ticket_price_paise IS NULL OR quoted_ticket_price_paise BETWEEN 1 AND 1000000000000)
        AND (quoted_service_charge_paise IS NULL OR quoted_service_charge_paise BETWEEN 0 AND 1000000000000))
);
CREATE UNIQUE INDEX "journey_requests_booking_id_key" ON "app"."journey_requests"("booking_id");
CREATE UNIQUE INDEX "journey_requests_packager_id_idempotency_key_key" ON "app"."journey_requests"("packager_id", "idempotency_key");
CREATE INDEX "journey_requests_owner_id_status_journey_date_idx" ON "app"."journey_requests"("owner_id", "status", "journey_date");
CREATE INDEX "journey_requests_owner_id_packager_id_created_at_idx" ON "app"."journey_requests"("owner_id", "packager_id", "created_at");
ALTER TABLE "app"."journey_requests" ADD CONSTRAINT "journey_requests_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "app"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."journey_requests" ADD CONSTRAINT "journey_requests_requested_by_user_id_fkey"
  FOREIGN KEY ("requested_by_user_id") REFERENCES "app"."app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."journey_requests" ADD CONSTRAINT "journey_requests_owner_id_packager_id_fkey"
  FOREIGN KEY ("owner_id", "packager_id") REFERENCES "app"."packagers"("owner_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "app"."journey_requests" ADD CONSTRAINT "journey_requests_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "app"."bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
