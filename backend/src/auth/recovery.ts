import { createHash, randomBytes } from 'node:crypto';

export const recoveryCodeTtlMs = 15 * 60_000;
// An agency's first-password code travels through the owner, so it lasts longer.
export const agencySetupCodeTtlMs = 72 * 3_600_000;

export function newRecoveryCode(): string {
  return randomBytes(12).toString('base64url');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}
