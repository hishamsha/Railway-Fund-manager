import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

config({ path: '.env.migrate', quiet: true });
// Only the migration process reads this URL. The web service uses DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('MIGRATION_DATABASE_URL') },
});
