-- Apply separately as the migration/admin role after creating the LOGIN role
-- app_runtime with a strong secret held outside this repository. Reapply after
-- every migration that adds a table. Do not run this as part of API startup.
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM app_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM app_runtime;

GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT CONNECT ON DATABASE postgres TO app_runtime;
-- The owner creates agency logins through the API. Owners are only ever created
-- by the bootstrap script, which uses the migration connection.
GRANT SELECT, INSERT, UPDATE ON app.app_users TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.auth_sessions, app.refresh_tokens TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.packagers, app.bookings, app.wallets, app.operation_requests TO app_runtime;
GRANT SELECT, INSERT ON app.customer_fund_entries, app.booking_deduction_entries, app.wallet_entries, app.audit_events TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.booking_accounts TO app_runtime;
-- Leg lists are replaced on booking edit and charge rules can be removed; both
-- changes are recorded in audit_events.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.booking_legs, app.service_charge_rules TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.journey_requests TO app_runtime;
