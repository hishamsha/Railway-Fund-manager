-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- Prisma emits unqualified names for the configured default schema. Pin the
-- search path so a migration never creates operational tables in public.
SET search_path TO "app", pg_catalog;

REVOKE ALL ON SCHEMA "app" FROM PUBLIC;

-- CreateTable
CREATE TABLE "app_users" (
    "id" UUID NOT NULL,
    "email_normalized" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "password_changed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_token_id" UUID,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packagers" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "packagers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "packager_id" UUID NOT NULL,
    "boarding_station" TEXT NOT NULL,
    "destination_station" TEXT NOT NULL,
    "journey_date" DATE NOT NULL,
    "train_identifier" TEXT NOT NULL,
    "ticket_price_paise" BIGINT NOT NULL,
    "service_charge_paise" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_fund_entries" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "entry_type" TEXT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "method" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "reversal_of_entry_id" UUID,
    "operation_request_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_fund_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "opening_balance_paise" BIGINT NOT NULL,
    "current_balance_paise" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_entries" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "booking_id" UUID,
    "entry_type" TEXT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "reversal_of_entry_id" UUID,
    "operation_request_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_requests" (
    "owner_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "operation_type" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "result_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "operation_requests_pkey" PRIMARY KEY ("owner_id","request_id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_users_email_normalized_key" ON "app_users"("email_normalized");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_token_id_key" ON "refresh_tokens"("replaced_by_token_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_consumed_at_revoked_at_idx" ON "refresh_tokens"("session_id", "consumed_at", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_session_id_id_key" ON "refresh_tokens"("session_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_session_id_replaced_by_token_id_key" ON "refresh_tokens"("session_id", "replaced_by_token_id");

-- CreateIndex
CREATE INDEX "packagers_owner_id_name_idx" ON "packagers"("owner_id", "name");

-- CreateIndex
CREATE INDEX "packagers_owner_id_is_archived_idx" ON "packagers"("owner_id", "is_archived");

-- CreateIndex
CREATE UNIQUE INDEX "packagers_owner_id_id_key" ON "packagers"("owner_id", "id");

-- CreateIndex
CREATE INDEX "bookings_owner_id_packager_id_journey_date_idx" ON "bookings"("owner_id", "packager_id", "journey_date");

-- CreateIndex
CREATE INDEX "bookings_owner_id_journey_date_idx" ON "bookings"("owner_id", "journey_date");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_owner_id_id_key" ON "bookings"("owner_id", "id");

-- CreateIndex
CREATE INDEX "customer_fund_entries_owner_id_booking_id_occurred_at_idx" ON "customer_fund_entries"("owner_id", "booking_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_fund_entries_owner_id_id_key" ON "customer_fund_entries"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_fund_entries_owner_id_booking_id_id_key" ON "customer_fund_entries"("owner_id", "booking_id", "id");

-- CreateIndex
CREATE INDEX "wallets_owner_id_is_active_idx" ON "wallets"("owner_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_owner_id_id_key" ON "wallets"("owner_id", "id");

-- CreateIndex
CREATE INDEX "wallet_entries_owner_id_wallet_id_occurred_at_idx" ON "wallet_entries"("owner_id", "wallet_id", "occurred_at");

-- CreateIndex
CREATE INDEX "wallet_entries_owner_id_booking_id_idx" ON "wallet_entries"("owner_id", "booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_owner_id_id_key" ON "wallet_entries"("owner_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_entries_owner_id_wallet_id_id_key" ON "wallet_entries"("owner_id", "wallet_id", "id");

-- CreateIndex
CREATE INDEX "audit_events_owner_id_occurred_at_idx" ON "audit_events"("owner_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_replaced_by_token_id_fkey" FOREIGN KEY ("session_id", "replaced_by_token_id") REFERENCES "refresh_tokens"("session_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packagers" ADD CONSTRAINT "packagers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_owner_id_packager_id_fkey" FOREIGN KEY ("owner_id", "packager_id") REFERENCES "packagers"("owner_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_fund_entries" ADD CONSTRAINT "customer_fund_entries_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_fund_entries" ADD CONSTRAINT "customer_fund_entries_owner_id_booking_id_fkey" FOREIGN KEY ("owner_id", "booking_id") REFERENCES "bookings"("owner_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_fund_entries" ADD CONSTRAINT "customer_fund_entries_owner_id_operation_request_id_fkey" FOREIGN KEY ("owner_id", "operation_request_id") REFERENCES "operation_requests"("owner_id", "request_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_fund_entries" ADD CONSTRAINT "customer_fund_entries_owner_id_booking_id_reversal_of_entr_fkey" FOREIGN KEY ("owner_id", "booking_id", "reversal_of_entry_id") REFERENCES "customer_fund_entries"("owner_id", "booking_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_owner_id_wallet_id_fkey" FOREIGN KEY ("owner_id", "wallet_id") REFERENCES "wallets"("owner_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_owner_id_booking_id_fkey" FOREIGN KEY ("owner_id", "booking_id") REFERENCES "bookings"("owner_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_owner_id_operation_request_id_fkey" FOREIGN KEY ("owner_id", "operation_request_id") REFERENCES "operation_requests"("owner_id", "request_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_owner_id_wallet_id_reversal_of_entry_id_fkey" FOREIGN KEY ("owner_id", "wallet_id", "reversal_of_entry_id") REFERENCES "wallet_entries"("owner_id", "wallet_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_requests" ADD CONSTRAINT "operation_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants not expressible in Prisma schema. The service still validates all
-- inputs and performs cross-row refund/reversal caps in locked transactions.
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_email_normalized_check"
  CHECK (email_normalized = lower(btrim(email_normalized)) AND char_length(email_normalized) BETWEEN 3 AND 320);
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_expiry_check"
  CHECK (absolute_expires_at > created_at);
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_expiry_check"
  CHECK (expires_at > issued_at);
ALTER TABLE "packagers" ADD CONSTRAINT "packagers_name_check"
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 160);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_journey_check"
  CHECK (char_length(btrim(boarding_station)) BETWEEN 1 AND 160
    AND char_length(btrim(destination_station)) BETWEEN 1 AND 160
    AND lower(btrim(boarding_station)) <> lower(btrim(destination_station))
    AND char_length(btrim(train_identifier)) BETWEEN 1 AND 160);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_money_check"
  CHECK (ticket_price_paise BETWEEN 1 AND 1000000000000
    AND service_charge_paise BETWEEN 0 AND 1000000000000);
ALTER TABLE "customer_fund_entries" ADD CONSTRAINT "customer_fund_entries_type_check"
  CHECK (entry_type IN ('receipt', 'refund', 'reversal')
    AND amount_paise BETWEEN 1 AND 1000000000000
    AND (method IS NULL OR method IN ('cash', 'upi', 'bank', 'other'))
    AND (entry_type = 'reversal') = (reversal_of_entry_id IS NOT NULL));
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_balance_check"
  CHECK (opening_balance_paise BETWEEN 0 AND 1000000000000
    AND current_balance_paise BETWEEN 0 AND 1000000000000);
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_name_check"
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 160);
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_type_check"
  CHECK (entry_type IN ('top_up', 'booking_debit', 'wallet_refund', 'debit_reversal', 'manual_adjustment_credit', 'manual_adjustment_debit')
    AND amount_paise BETWEEN 1 AND 1000000000000
    AND (entry_type NOT IN ('booking_debit', 'wallet_refund', 'debit_reversal') OR booking_id IS NOT NULL)
    AND (entry_type = 'debit_reversal') = (reversal_of_entry_id IS NOT NULL));
ALTER TABLE "operation_requests" ADD CONSTRAINT "operation_requests_payload_check"
  CHECK (char_length(operation_type) BETWEEN 1 AND 80
    AND payload_hash ~ '^[0-9a-f]{64}$'
    AND (completed_at IS NULL OR result_json IS NOT NULL));

-- Posted finance rows are append-only, including for privileged application
-- connections. Corrections require new linked rows. An admin migration must
-- explicitly remove these triggers before any exceptional data repair.
CREATE FUNCTION "app"."reject_finance_entry_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'posted finance entries are immutable';
END;
$$;
REVOKE ALL ON FUNCTION "app"."reject_finance_entry_change"() FROM PUBLIC;
CREATE TRIGGER customer_fund_entries_immutable
  BEFORE UPDATE OR DELETE ON "customer_fund_entries"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_finance_entry_change"();
CREATE TRIGGER wallet_entries_immutable
  BEFORE UPDATE OR DELETE ON "wallet_entries"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_finance_entry_change"();

-- Supabase's API roles must not receive private schema access even if the
-- project has granted them default privileges elsewhere.
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM %I', api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;
