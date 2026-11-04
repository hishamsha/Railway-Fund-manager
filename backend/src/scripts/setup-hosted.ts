// Prepares a new hosted database and the files the API host needs. Run it in your
// own terminal: the database password is typed here and is never echoed or logged.
// Files it writes stay in the ignored backend/.secrets/production folder.
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { Pool } from 'pg';
import { isLocalHost, migrationUrl, runtimeUrl } from './hosted-url.js';

const dir = resolve('.secrets/production');
const caFile = resolve(dir, 'prod-ca-2021.crt');
const envFile = resolve(dir, 'render-database-url.txt');
const hostCaPath = '/etc/secrets/prod-ca-2021.crt';
const localTest = process.argv.includes('--local-test');

function fail(message: string): never {
  stdout.write(`\nStopped: ${message}\n`);
  process.exit(1);
}
function step(message: string) { stdout.write(`\n${message}\n`); }

/** Reads one line without showing what is typed. */
function askHidden(question: string): Promise<string> {
  if (!stdin.isTTY) fail('Run this in an interactive terminal.');
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((done) => {
    let value = '';
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write('\n');
          done(value.trim());
          return;
        }
        if (char === '\u0003') { stdin.setRawMode(false); process.exit(130); }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

mkdirSync(dir, { recursive: true });
if (!localTest && !existsSync(caFile)) {
  fail(`Download the SSL certificate from Supabase (Project Settings, Database) and save it as:\n  ${caFile}`);
}

const input = process.env.HOSTED_MIGRATION_URL ??
  await askHidden('Paste the Session pooler connection string, with your database password in it (hidden): ');
let parsed: URL;
try { parsed = new URL(input); } catch { fail('That is not a connection string. It should start with postgresql://'); }
if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) fail('The connection string should start with postgresql://');
if (input.includes('[YOUR-PASSWORD]')) fail('Replace [YOUR-PASSWORD] with your database password first.');
if (isLocalHost(parsed) && !localTest) fail('That is a local database. This script is for the hosted one.');

const adminUrl = localTest ? input : migrationUrl(input, caFile);
const pool = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 15000 });
try {
  step('1. Checking the database...');
  const info = await pool.query<{ version: number; zone: string }>(
    "SELECT current_setting('server_version_num')::int AS version, current_setting('TimeZone') AS zone");
  const { version, zone } = info.rows[0]!;
  if (version < 150000) fail('This needs PostgreSQL 15 or newer.');
  // Expiry checks for recovery and setup codes are wrong in other time zones.
  if (zone !== 'UTC' && zone !== 'Etc/UTC') fail(`The database time zone is ${zone}. It must be UTC.`);
  stdout.write(`   PostgreSQL ${Math.floor(version / 10000)}, time zone ${zone}.\n`);

  step('2. Setting up the restricted API role...');
  const existing = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime'");
  const saved = existsSync(envFile) ? new URL(readFileSync(envFile, 'utf8').trim()) : null;
  const password = saved ? decodeURIComponent(saved.password) : randomBytes(32).toString('base64url');
  // The password is base64url or came from this script, so it holds no quote characters.
  await pool.query(`${existing.rowCount ? 'ALTER' : 'CREATE'} ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
  writeFileSync(envFile, `${runtimeUrl(input, password, hostCaPath)}\n`, { mode: 0o600 });

  step('3. Applying database changes...');
  const shell = process.platform === 'win32';
  const migrate = spawnSync(shell ? 'npx.cmd' : 'npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell,
    env: { ...process.env, MIGRATION_DATABASE_URL: adminUrl } });
  if (migrate.status !== 0) fail('The database changes did not apply. Nothing else was changed after step 2.');

  step('4. Applying API permissions...');
  const database = await pool.query<{ name: string }>('SELECT current_database() AS name');
  const grants = readFileSync(resolve('prisma/runtime_grants.sql'), 'utf8')
    .replace('DATABASE postgres', `DATABASE "${database.rows[0]!.name}"`);
  await pool.query(grants);

  step('5. Creating sign-in keys for the host...');
  const privatePath = resolve(dir, 'jwt-private.pem');
  const publicPath = resolve(dir, 'jwt-public.pem');
  if (existsSync(privatePath) && existsSync(publicPath)) {
    stdout.write('   Already there, so keeping them.\n');
  } else {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
    writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600 });
  }

  step('6. Your owner login...');
  const owners = await pool.query("SELECT count(*)::int AS count FROM app.app_users WHERE role = 'owner'");
  if (owners.rows[0].count > 0) {
    stdout.write('   An owner already exists, so skipping this.\n');
  } else if (localTest) {
    stdout.write('   Skipped in the local test.\n');
  } else {
    stdout.write('   Choose the email and password you will use on the live site.\n');
    const owner = spawnSync(shell ? 'npx.cmd' : 'npx', ['tsx', 'src/scripts/bootstrap-owner.ts'], { stdio: 'inherit', shell,
      env: { ...process.env, MIGRATION_DATABASE_URL: adminUrl } });
    if (owner.status !== 0) fail('The owner login was not created. Run this script again to retry; the earlier steps are safe to repeat.');
  }

  stdout.write(`\nDone. These files are ready for the next step in docs/HOSTING.md:\n  ${dir}\n`);
} catch (error) {
  // Only the message: a connection error object can carry the connection string.
  const message = error instanceof Error ? error.message : 'Unknown error';
  fail(message.replaceAll(input, '[connection string]').replaceAll(adminUrl, '[connection string]'));
} finally {
  await pool.end();
}
