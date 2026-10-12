import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.migrate', quiet: true });
import { Client } from 'pg';

if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is missing');

const client = new Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  connectionTimeoutMillis: 7000,
});

try {
  await client.connect();
  const result = await client.query<{ role: string }>('select current_user as role');
  process.stdout.write(`Migration database connection works as ${result.rows[0]?.role}\n`);
} finally {
  await client.end();
}
