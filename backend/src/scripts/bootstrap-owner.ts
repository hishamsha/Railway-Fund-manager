import 'dotenv/config';
import { config } from 'dotenv';
config({ path: '.env.migrate', quiet: true });
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { PrismaClient } from '../generated/prisma/client.js';

if (!stdin.isTTY || !stdout.isTTY) throw new Error('Run owner bootstrap in an interactive terminal');
const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error('MIGRATION_DATABASE_URL is missing');

const rl = createInterface({ input: stdin, output: stdout });
const email = z.email().max(254).parse((await rl.question('Owner email: ')).trim().toLowerCase());
const displayName = (await rl.question('Display name: ')).trim();
rl.close();

stdout.write('Password (at least 12 characters): ');
stdin.setRawMode(true);
stdin.resume();
const password = await new Promise<string>((resolve, reject) => {
  let value = '';
  const onData = (chunk: Buffer) => {
    for (const char of chunk.toString()) {
      if (char === '\r' || char === '\n') {
        stdin.off('data', onData);
        stdin.setRawMode(false);
        stdout.write('\n');
        resolve(value);
        return;
      }
      if (char === '\u0003') { stdin.setRawMode(false); reject(new Error('Cancelled')); return; }
      if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
      else value += char;
    }
  };
  stdin.on('data', onData);
});
stdin.pause();
z.string().min(12).max(1024).parse(password);

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) });
try {
  const owner = await db.appUser.create({ data: {
    emailNormalized: email, displayName: displayName || null,
    passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
  } });
  stdout.write(`Created owner ${owner.id}\n`);
} finally { await db.$disconnect(); }
