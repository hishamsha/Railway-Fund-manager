import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { decodeProtectedHeader, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';

const issuer = process.env.JWT_ISSUER ?? 'train-fund-manager-api';
const audience = process.env.JWT_AUDIENCE ?? 'train-fund-manager-mobile';
const kid = process.env.JWT_ACTIVE_KID ?? 'development-1';
export const accessTtlSeconds = 600;

async function pem(name: string, fileName: string): Promise<string> {
  const inline = process.env[name];
  if (inline) return inline.replace(/\\n/g, '\n');
  const path = process.env[fileName];
  if (!path) throw new Error(`${fileName} is missing`);
  return readFile(path, 'utf8');
}

export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  const key = await importPKCS8(await pem('JWT_PRIVATE_KEY_PEM', 'JWT_PRIVATE_KEY_FILE'), 'RS256');
  return new SignJWT({ sid: sessionId, typ: 'access' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer).setAudience(audience).setSubject(userId)
    .setJti(randomBytes(16).toString('hex')).setIssuedAt().setNotBefore('0s')
    .setExpirationTime(`${accessTtlSeconds}s`).sign(key);
}

export async function verifyAccessToken(token: string): Promise<{ userId: string; sessionId: string }> {
  const tokenKid = decodeProtectedHeader(token).kid;
  if (typeof tokenKid !== 'string' || !tokenKid) throw new Error('Missing signing key ID');
  let publicPem: string;
  if (process.env.JWT_PUBLIC_KEYS_JSON) {
    const keys: unknown = JSON.parse(process.env.JWT_PUBLIC_KEYS_JSON);
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw new Error('Invalid public key set');
    const selected = (keys as Record<string, unknown>)[tokenKid];
    if (typeof selected !== 'string' || !selected) throw new Error('Unknown signing key');
    publicPem = selected.replace(/\\n/g, '\n');
  } else {
    if (tokenKid !== kid) throw new Error('Unknown signing key');
    publicPem = await pem('JWT_PUBLIC_KEY_PEM', 'JWT_PUBLIC_KEY_FILE');
  }
  const key = await importSPKI(publicPem, 'RS256');
  const { payload, protectedHeader } = await jwtVerify(token, key, {
    algorithms: ['RS256'], issuer, audience,
    requiredClaims: ['sub', 'sid', 'jti', 'iat', 'nbf', 'exp'],
  });
  if (protectedHeader.kid !== tokenKid) throw new Error('Unknown signing key');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (payload.typ !== 'access' || !uuid.test(payload.sub ?? '') ||
      typeof payload.sid !== 'string' || !uuid.test(payload.sid)) throw new Error('Invalid token claims');
  return { userId: payload.sub!, sessionId: payload.sid };
}

export function newRefreshToken(): string { return randomBytes(32).toString('base64url'); }
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
