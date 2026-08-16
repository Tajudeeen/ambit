import { getConfig } from '@ambit/config';
import { MemoryCheckpointStore } from './checkpoint.js';
import { indexOnce } from './indexer.js';

/**
 * M1 entrypoint: index live BSC ERC-8004 registrations.
 *
 * Real chain read via viem. Checkpoint is in-memory for M1 (swap to Postgres
 * in M2). No agents are hardcoded; every emitted agent comes from an on-chain
 * `Registered` event.
 */
export async function main(): Promise<void> {
  const cfg = getConfig();
  const store = new MemoryCheckpointStore();
  // Prefer the recon-verified registry address; fall back to config/env.
  const rpcUrl = cfg.bsc.rpcUrl;
  const chainId = cfg.bsc.chainId;
  console.log(`[ambit-indexer] M1 — indexing BSC (${chainId}) ERC-8004 identity registry`);
  const { toBlock, agents } = await indexOnce({
    rpcUrl,
    chainId,
    checkpoint: store,
    batchSize: cfg.indexer.batchSize,
    onAgent: (a) => console.log(`  + ${a.agentRegistry} (${a.name})`),
    onUnresolved: (ev, reason) => console.warn(`  ! agentId ${ev.agentId} unresolved: ${reason}`),
  });
  console.log(`[ambit-indexer] M1 pass complete: reached block ${toBlock}, ${agents} new agent(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('[ambit-indexer] fatal', e);
    process.exit(1);
  });
}
