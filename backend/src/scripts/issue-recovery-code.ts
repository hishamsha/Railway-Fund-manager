import 'dotenv/config';
import { z } from 'zod';
import { closePrisma, getPrisma } from '../database/prisma.js';
import { hashRecoveryCode, newRecoveryCode, recoveryCodeTtlMs } from '../auth/recovery.js';

const emailArg = process.argv[2];
const email = emailArg ? z.email().max(254).parse(emailArg.trim().toLowerCase()) : undefined;
const db = getPrisma();

try {
  const users = await db.appUser.findMany({
    where: { isActive: true, role: 'owner', ...(email ? { emailNormalized: email } : {}) },
    select: { id: true, emailNormalized: true },
    take: 2,
  });
  if (users.length !== 1) {
    throw new Error('Specify the active owner email: npm run owner:recovery-code -- owner@example.com');
  }
  const code = newRecoveryCode();
  const expiresAt = new Date(Date.now() + recoveryCodeTtlMs);
  await db.appUser.update({
    where: { id: users[0]!.id },
    data: { passwordResetHash: hashRecoveryCode(code), passwordResetExpiresAt: expiresAt },
  });
  process.stdout.write(`Recovery code for ${users[0]!.emailNormalized}: ${code}\n`);
  process.stdout.write(`Expires at ${expiresAt.toISOString()}. It can be used once.\n`);
} finally {
  await closePrisma();
}
