import 'dotenv/config';
import { app } from './app.js';
import { env } from './config/env.js';
import { closePrisma } from './database/prisma.js';

const server = app.listen(env.PORT, () => {
  process.stdout.write(`API listening on port ${env.PORT}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => {
    void closePrisma().finally(() => process.exit(0));
  }));
}
