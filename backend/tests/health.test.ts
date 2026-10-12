import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('API foundation', () => {
  it('returns a minimal health result', async () => {
    const result = await request(app).get('/health').expect(200);
    expect(result.body).toEqual({ status: 'ok' });
    expect(result.headers['x-request-id']).toBeTruthy();
  });

  it('uses the standard error envelope', async () => {
    const result = await request(app).get('/missing').expect(404);
    expect(result.body.error.code).toBe('NOT_FOUND');
    expect(result.body.error.request_id).toBe(result.headers['x-request-id']);
  });

  it('does not claim database readiness without a connection', async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const result = await request(app).get('/ready').expect(503);
      expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
    } finally {
      if (previous) process.env.DATABASE_URL = previous;
    }
  });
});
