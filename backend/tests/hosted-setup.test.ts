import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isLocalHost, migrationUrl, runtimeUrl } from '../src/scripts/hosted-url.js';

describe('hosted connection strings', () => {
  const pooler = 'postgresql://postgres.abcxyz:p%40ss@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?pgbouncer=true';

  it('gives the API the restricted role on the same host, with verified TLS', () => {
    const url = new URL(runtimeUrl(pooler, 'generated', '/etc/secrets/ca.crt'));
    expect(url.username).toBe('app_runtime.abcxyz');
    expect(url.password).toBe('generated');
    expect(url.host).toBe('aws-0-ap-south-1.pooler.supabase.com:5432');
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
    expect(url.searchParams.get('sslrootcert')).toBe('/etc/secrets/ca.crt');
    expect(url.searchParams.get('schema')).toBe('app');
    expect(url.searchParams.has('pgbouncer')).toBe(false);
    expect(url.toString()).not.toContain('p%40ss');
  });
  it('handles a direct connection login with no project part', () => {
    expect(new URL(runtimeUrl('postgresql://postgres:x@db.example.com/postgres', 'y', '/c')).username).toBe('app_runtime');
  });
  it('keeps the admin login for migrations', () => {
    const url = new URL(migrationUrl(pooler, 'C:\\keys\\ca.crt'));
    expect(url.username).toBe('postgres.abcxyz');
    expect(url.password).toBe('p%40ss');
    expect(url.searchParams.get('sslrootcert')).toBe('C:\\keys\\ca.crt');
  });
  it('recognises local databases', () => {
    expect(isLocalHost(new URL('postgresql://a@127.0.0.1:5432/x'))).toBe(true);
    expect(isLocalHost(new URL(pooler))).toBe(false);
  });
});

describe('serving the web app', () => {
  let dist: string;
  let app: typeof import('../src/app.js').app;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'web-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>App</title>');
    writeFileSync(join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
    vi.resetModules();
    process.env.WEB_DIST = dist;
    process.env.TRUST_PROXY_HOPS = '1';
    ({ app } = await import('../src/app.js'));
  });
  afterAll(() => {
    delete process.env.WEB_DIST;
    delete process.env.TRUST_PROXY_HOPS;
    rmSync(dist, { recursive: true, force: true });
  });

  it('serves the page, and the page for addresses the browser app handles', async () => {
    for (const path of ['/', '/bookings/123', '/requests/new']) {
      const response = await request(app).get(path);
      expect([path, response.status]).toEqual([path, 200]);
      expect(response.text).toContain('<title>App</title>');
      expect(response.headers['cache-control']).toBe('no-cache');
    }
  });
  it('caches built files for a long time', async () => {
    const response = await request(app).get('/assets/index-abc.js');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
  });
  it('does not answer a missing file or API path with the page', async () => {
    expect((await request(app).get('/assets/missing.js')).status).toBe(404);
    const api = await request(app).get('/api/nothing');
    expect(api.status).toBe(404);
    expect(api.body.error.code).toBe('NOT_FOUND');
  });
  it('keeps API and health routes working', async () => {
    expect((await request(app).get('/health')).body.status).toBe('ok');
    expect((await request(app).get('/api/v1/health')).body.status).toBe('ok');
    expect((await request(app).get('/api/v1/packagers')).status).toBe(401);
  });
  it('trusts only the configured number of proxies', async () => {
    expect(app.get('trust proxy')).toBe(1);
  });
});
