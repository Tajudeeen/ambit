/**
 * Environment configuration loader.
 *
 * Reads from process.env with safe defaults. No .env file is committed; the
 * consumer is expected to load dotenv (or the platform's secret manager)
 * before importing this module. Every value here is either non-secret (RPC
 * URLs, contract addresses) or a reference to a secret that must NOT be logged.
 */
export interface ChainConfig {
  rpcUrl: string;
  chainId: number;
}

export interface Config {
  bsc: ChainConfig;
  bscTestnet: ChainConfig;
  erc8004: {
    identityRegistry: string;
    reputationRegistry: string;
  };
  databaseUrl: string;
  apiPort: number;
  webApiUrl: string;
  indexer: {
    batchSize: number;
    startBlock?: number;
  };
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function intOpt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (
    (raw !== undefined && !/^\d+$/.test(raw)) ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Environment variable ${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export const MAX_INDEXER_BATCH_SIZE = 10_000;

export function loadConfig(): Config {
  return {
    bsc: {
      rpcUrl: opt('BSC_RPC_URL', 'https://bsc-dataseed.binance.org'),
      chainId: intOpt('BSC_CHAIN_ID', 56, 1, Number.MAX_SAFE_INTEGER),
    },
    bscTestnet: {
      rpcUrl: opt('BSC_TESTNET_RPC_URL', 'https://data-seed-prebsc-1-s1.binance.org:8545'),
      chainId: intOpt('BSC_TESTNET_CHAIN_ID', 97, 1, Number.MAX_SAFE_INTEGER),
    },
    erc8004: {
      identityRegistry: opt('ERC8004_IDENTITY_REGISTRY_BSC', ''),
      reputationRegistry: opt('ERC8004_REPUTATION_REGISTRY_BSC', ''),
    },
    databaseUrl: req('DATABASE_URL'),
    apiPort: intOpt('API_PORT', 8787, 1, 65_535),
    webApiUrl: opt('NEXT_PUBLIC_API_URL', 'http://localhost:8787'),
    indexer: {
      batchSize: intOpt('INDEXER_BATCH_SIZE', 200, 1, MAX_INDEXER_BATCH_SIZE),
      startBlock:
        process.env.INDEXER_START_BLOCK === undefined
          ? undefined
          : intOpt('INDEXER_START_BLOCK', 0, 0, Number.MAX_SAFE_INTEGER),
    },
  };
}

let cached: Config | null = null;

/** Load config once and memoize. Call `reloadConfig()` in tests if needed. */
export function getConfig(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

export function reloadConfig(): Config {
  cached = loadConfig();
  return cached;
}
