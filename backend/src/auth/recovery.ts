import { createHash, randomBytes } from 'node:crypto';

export const recoveryCodeTtlMs = 15 * 60_000;

export function newRecoveryCode(): string {
  return randomBytes(12).toString('base64url');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}
