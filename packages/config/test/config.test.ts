import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { loadConfig } from '../src/index.js';

describe('config/loadConfig', () => {
  const prev = process.env;
  beforeEach(() => {
    process.env = { ...prev };
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
  });
  afterAll(() => {
    process.env = prev;
  });

  it('loads with sensible defaults when optional vars are absent', () => {
    delete process.env.BSC_RPC_URL;
    delete process.env.ERC8004_IDENTITY_REGISTRY_BSC;
    const c = loadConfig();
    expect(c.bsc.chainId).toBe(56);
    expect(c.bsc.rpcUrl).toContain('binance.org');
    expect(c.erc8004.identityRegistry).toBe('');
    expect(c.apiPort).toBe(8787);
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => loadConfig()).toThrow(/DATABASE_URL/);
  });

  it('parses INDEXER_START_BLOCK when set', () => {
    process.env.INDEXER_START_BLOCK = '12345';
    const c = loadConfig();
    expect(c.indexer.startBlock).toBe(12345);
  });
});
