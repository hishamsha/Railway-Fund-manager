-- The trigger has no unqualified object references, but pin its search path
-- so a caller cannot influence future function resolution.
ALTER FUNCTION app.reject_finance_entry_change() SET search_path = pg_catalog;
