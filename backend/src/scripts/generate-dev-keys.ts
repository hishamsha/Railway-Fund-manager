import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.env.NODE_ENV === 'production') throw new Error('Development key generator cannot run in production');
const dir = resolve('.secrets');
const privatePath = resolve(dir, 'jwt-private.pem');
const publicPath = resolve(dir, 'jwt-public.pem');
await mkdir(dir, { recursive: true });
const existing = await Promise.all([privatePath, publicPath].map(async (path) => {
  try { await readFile(path); return true; } catch { return false; }
}));
if (existing.some(Boolean)) throw new Error('Key file already exists; refusing to overwrite');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
await writeFile(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
await writeFile(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o600, flag: 'wx' });
const envPath = resolve('.env');
const oldEnv = await readFile(envPath, 'utf8');
const lines = [
  `JWT_PRIVATE_KEY_FILE=${privatePath}`,
  `JWT_PUBLIC_KEY_FILE=${publicPath}`,
  'JWT_ACTIVE_KID=development-1',
];
await writeFile(envPath, `${oldEnv.trimEnd()}\n${lines.join('\n')}\n`, { mode: 0o600 });
process.stdout.write('Generated local development JWT keys in ignored backend/.secrets\n');
