-- The function exists after the init migration on both fresh and existing DBs.
ALTER FUNCTION app.reject_finance_entry_change() SET search_path = pg_catalog;
