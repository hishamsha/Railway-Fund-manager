-- Date-window reports and recent statement/dashboard pages filter by owner.
CREATE INDEX customer_entries_owner_occurred_id_idx
  ON app.customer_fund_entries (owner_id, occurred_at DESC, id DESC);
CREATE INDEX wallet_entries_owner_occurred_id_idx
  ON app.wallet_entries (owner_id, occurred_at DESC, id DESC);
CREATE INDEX bookings_owner_created_id_idx
  ON app.bookings (owner_id, created_at DESC, id DESC);
CREATE INDEX bookings_owner_packager_created_id_idx
  ON app.bookings (owner_id, packager_id, created_at DESC, id DESC);
