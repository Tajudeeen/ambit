import { createPublicClient, http, type PublicClient, type Transport } from 'viem';
import { bsc, bscTestnet } from 'viem/chains';
import type { NetworkRegistries } from './networks.js';

/**
 * Production RPC clients for BSC. Reads the RPC URL from config/env.
 * We intentionally DO NOT hardcode a single RPC — operators must supply a
 * reliable endpoint (public RPCs rate-limit and will break indexing).
 */
export function createBscClient(rpcUrl: string, testnet = false): PublicClient {
  const chain = testnet ? bscTestnet : bsc;
  return createPublicClient({
    chain,
    transport: http(rpcUrl, { timeout: 20_000, retryCount: 3, retryDelay: 500 }),
  }) as PublicClient<Transport>;
}

/** Convenience: build a client straight from a NetworkRegistries config. */
export function clientForNetwork(net: NetworkRegistries, rpcUrl: string): PublicClient {
  return createBscClient(rpcUrl, net.chainId === 97);
}
