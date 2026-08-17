import { serve } from '@hono/node-server';
import { getConfig } from '@ambit/config';
import { createApp } from './index.js';

const config = getConfig();
const app = createApp();

serve({ fetch: app.fetch, port: config.apiPort }, (info) => {
  console.log(`[ambit-api] listening on http://localhost:${info.port}`);
});
