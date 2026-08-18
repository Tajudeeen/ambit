import { serve } from '@hono/node-server';
import { getConfig } from '@ambit/config';
import { createApp, logOperationalEvent } from './index.js';

const config = getConfig();
const app = createApp({ logger: logOperationalEvent });

serve({ fetch: app.fetch, port: config.apiPort }, (info) => {
  logOperationalEvent({
    event: 'startup',
    service: 'ambit-api',
    releaseId: process.env.AMBIT_RELEASE_ID ?? null,
    port: info.port,
    timestamp: new Date().toISOString(),
  });
});
