import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { health } from '../src/index.js';

describe('api health', () => {
  it('returns ok', async () => {
    const app = new Hono();
    app.get('/health', health);
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
