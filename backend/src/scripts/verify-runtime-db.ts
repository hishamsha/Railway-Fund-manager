import 'dotenv/config';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is missing');

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
const tables = [
  'app_users', 'auth_sessions', 'refresh_tokens', 'packagers', 'bookings',
  'customer_fund_entries', 'wallets', 'wallet_entries', 'operation_requests', 'audit_events',
];

try {
  const identity = await pool.query<{ role: string; schema_usage: boolean; schema_create: boolean }>(
    "SELECT current_user AS role, has_schema_privilege(current_user, 'app', 'USAGE') AS schema_usage, has_schema_privilege(current_user, 'app', 'CREATE') AS schema_create",
  );
  const role = identity.rows[0];
  if (!role?.schema_usage || role.schema_create) throw new Error('Runtime schema privileges are incorrect');

  const isolation = await pool.query<{
    anon_usage: boolean; authenticated_usage: boolean; auth_usage: boolean;
    storage_usage: boolean; migration_select: boolean;
  }>(`SELECT
    has_schema_privilege('anon', 'app', 'USAGE') AS anon_usage,
    has_schema_privilege('authenticated', 'app', 'USAGE') AS authenticated_usage,
    has_schema_privilege(current_user, 'auth', 'USAGE') AS auth_usage,
    has_schema_privilege(current_user, 'storage', 'USAGE') AS storage_usage,
    has_table_privilege(current_user, 'app._prisma_migrations', 'SELECT') AS migration_select`);
  const check = isolation.rows[0];
  if (!check || Object.values(check).some(Boolean)) throw new Error('Public or cross-schema privileges are incorrect');

  for (const table of tables) {
    const target = `app.${table}`;
    const result = await pool.query<{ exists: string | null; can_select: boolean; can_delete: boolean; can_update: boolean }>(
      "SELECT to_regclass($1) AS exists, has_table_privilege(current_user, $1, 'SELECT') AS can_select, has_table_privilege(current_user, $1, 'DELETE') AS can_delete, has_table_privilege(current_user, $1, 'UPDATE') AS can_update",
      [target],
    );
    const privileges = result.rows[0];
    if (!privileges?.exists || !privileges.can_select || privileges.can_delete) {
      throw new Error(`Runtime privileges are incorrect for ${target}`);
    }
    if (['customer_fund_entries', 'wallet_entries', 'audit_events'].includes(table) && privileges.can_update) {
      throw new Error(`Append-only table permits update: ${target}`);
    }
  }

  const trigger = await pool.query<{ config: string[] | null }>(`
    SELECT p.proconfig AS config
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'reject_finance_entry_change'
      AND p.pronargs = 0`);
  if (trigger.rows.length !== 1 ||
    !trigger.rows[0]!.config?.includes('search_path=pg_catalog')) {
    throw new Error('Finance trigger search path is not pinned');
  }

  process.stdout.write(`Verified ${tables.length} private tables, finance trigger, and runtime role ${role.role}\n`);
} finally {
  await pool.end();
}
