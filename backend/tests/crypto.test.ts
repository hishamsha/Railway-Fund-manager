import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { afterEach, expect, it } from 'vitest';
import { signAccessToken, verifyAccessToken } from '../src/auth/crypto.js';

afterEach(() => {
  delete process.env.JWT_PRIVATE_KEY_PEM;
  delete process.env.JWT_PUBLIC_KEY_PEM;
  delete process.env.JWT_PUBLIC_KEYS_JSON;
});

it('accepts an unexpired retired public key while signing with the active key', async () => {
  const active = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const retired = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const activePrivate = active.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const activePublic = active.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const retiredPrivate = retired.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const retiredPublic = retired.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  process.env.JWT_PRIVATE_KEY_PEM = activePrivate;
  process.env.JWT_PUBLIC_KEYS_JSON = JSON.stringify({ 'development-1': activePublic,
    'retired-1': retiredPublic });
  const userId = randomUUID();
  const sessionId = randomUUID();
  const current = await signAccessToken(userId, sessionId);
  expect(await verifyAccessToken(current)).toEqual({ userId, sessionId });
  const oldKey = await importPKCS8(retiredPrivate, 'RS256');
  const old = await new SignJWT({ sid: sessionId, typ: 'access' })
    .setProtectedHeader({ alg: 'RS256', kid: 'retired-1' })
    .setIssuer('train-fund-manager-api').setAudience('train-fund-manager-mobile')
    .setSubject(userId).setJti(randomUUID()).setIssuedAt().setNotBefore('0s')
    .setExpirationTime('10m').sign(oldKey);
  expect(await verifyAccessToken(old)).toEqual({ userId, sessionId });
  process.env.JWT_PUBLIC_KEYS_JSON = JSON.stringify({ 'development-1': activePublic });
  await expect(verifyAccessToken(old)).rejects.toThrow('Unknown signing key');
});
