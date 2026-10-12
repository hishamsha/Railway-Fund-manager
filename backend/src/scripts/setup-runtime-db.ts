import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.migrate', quiet: true });
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) throw new Error('MIGRATION_DATABASE_URL is missing');

const pool = new Pool({ connectionString: migrationUrl, max: 1, connectionTimeoutMillis: 5000 });
const password = randomBytes(32).toString('base64url');
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
const grantsPath = fileURLToPath(new URL('../../prisma/runtime_grants.sql', import.meta.url));

try {
  const existing = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') AS exists",
  );
  if (existing.rows[0]?.exists) {
    throw new Error('app_runtime already exists; inspect its credentials and grants before changing it');
  }

  // password is generated from base64url and cannot contain SQL quoting chars.
  await pool.query(`CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
  await pool.query(await readFile(grantsPath, 'utf8'));

  const runtimeUrl = new URL(migrationUrl);
  const poolerAccount = runtimeUrl.username.includes('.')
    ? `app_runtime.${runtimeUrl.username.split('.').slice(1).join('.')}`
    : 'app_runtime';
  runtimeUrl.username = poolerAccount;
  runtimeUrl.password = password;
  runtimeUrl.searchParams.set('schema', 'app');

  const oldEnv = await readFile(envPath, 'utf8');
  const line = `DATABASE_URL=${runtimeUrl.toString()}`;
  const nextEnv = /^DATABASE_URL=.*$/m.test(oldEnv)
    ? oldEnv.replace(/^DATABASE_URL=.*$/m, line)
    : `${oldEnv.trimEnd()}\n${line}\n`;
  await writeFile(envPath, nextEnv, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write('Created app_runtime, applied grants, and saved DATABASE_URL to ignored backend/.env\n');
} finally {
  await pool.end();
}
