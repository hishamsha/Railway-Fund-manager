import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (client) return client;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is missing');
  const adapter = new PrismaPg({ connectionString, max: 5 });
  client = new PrismaClient({ adapter });
  return client;
}

export async function closePrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
