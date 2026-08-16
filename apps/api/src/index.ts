import { Hono, type Context } from 'hono';

/**
 * M0 baseline API surface.
 *
 * Real marketplace endpoints (search, profiles, hiring, execution) land in M9.
 * The health/readiness endpoints exist from day one for production observability
 * (see brief §23). They deliberately require no DB/RPC so they cannot fail
 * closed for the wrong reason.
 */
export const health = (c: Context) => c.json({ status: 'ok', service: 'ambit-api' });

export function createApp(): Hono {
  const app = new Hono();
  app.get('/health', health);
  app.get('/ready', (c) => c.json({ status: 'ok', service: 'ambit-api' }));
  return app;
}
