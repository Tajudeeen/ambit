// Loads environment variables before any other module imports config.
// The monorepo keeps .env at the repo root, but `pnpm --filter @ambit/api dev`
// runs with cwd = apps/api, so dotenv's default lookup would miss it. Resolve
// the root .env explicitly (apps/api/src -> repo root) regardless of cwd.
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
