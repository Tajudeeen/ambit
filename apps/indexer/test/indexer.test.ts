import { describe, it, expect, beforeAll } from 'vitest';
import { main } from '../src/index.js';

describe('indexer baseline', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  });

  it('boots without throwing when config is present', async () => {
    await expect(main()).resolves.toBeUndefined();
  });
});

