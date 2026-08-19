import { describe, it, expect } from 'vitest';
import { indexOnce } from '../src/indexer.js';
import { MemoryCheckpointStore } from '../src/checkpoint.js';
import { getNetwork, type RegisteredEvent } from '@ambit/erc8004';
import type { PublicClient } from 'viem';

const net = getNetwork(56);

/**
 * Deterministic fake viem client. It returns ONE real-shaped `Registered`
 * event, proving the indexer pipeline (read events -> resolve metadata ->
 * emit agent) works end to end WITHOUT a live RPC and WITHOUT fabricating
 * agents. The agent only exists because the fake chain emitted a real event.
 */
function fakeClient(events: RegisteredEvent[]): PublicClient {
  return {
    getBlockNumber: async () => 41_000_100n,
    getContractEvents: async (req: { eventName?: string }) =>
      req.eventName === 'NewFeedback'
        ? []
        : events.map((e) => ({
            args: { agentId: e.agentId, agentURI: e.agentURI, owner: e.owner },
            blockNumber: e.blockNumber,
            transactionHash: e.txHash,
            logIndex: e.logIndex,
          })),
  } as unknown as PublicClient;
}

// Patch createBscClient by monkeypatching the module is brittle; instead we
// pass a client through a tiny shim. indexOnce builds its own client from
// rpcUrl, so we instead test the lower-level path via a direct reader test
// in erc8004. Here we validate indexOnce's dedup + checkpoint + emit logic by
// stubbing fetch + using a fixed toBlock and a MemoryCheckpointStore. To keep
// indexOnce hermetic we override createBscClient via vi.mock.
import { vi } from 'vitest';
vi.mock('@ambit/erc8004', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ambit/erc8004')>();
  return {
    ...mod,
    createBscClient: () =>
      fakeClient([
        {
          agentId: 777n,
          agentURI:
            'data:application/json,' +
            encodeURIComponent(
              JSON.stringify({
                name: 'LiveBot',
                services: [{ name: 'liquidity-rebalancing', endpoint: 'https://live.bot' }],
              }),
            ),
          owner: '0x2222222222222222222222222222222222222222',
          blockNumber: 41_000_050n,
          txHash: '0xdeadbeef',
          logIndex: 0,
        },
      ]),
  };
});

describe('indexOnce integration (hermetic, real event shape)', () => {
  it('emits one discoverable agent from a single on-chain Registered event', async () => {
    const emitted: string[] = [];
    const { agents, toBlock } = await indexOnce({
      rpcUrl: 'http://fake',
      chainId: 56,
      checkpoint: new MemoryCheckpointStore(),
      batchSize: 200,
      toBlock: 41_000_100,
      probeImpl: async (u) => ({ url: u, status: 'up', checkedAt: '' }),
      onAgent: (a) => emitted.push(a.agentRegistry),
    });
    expect(agents).toBe(1);
    expect(emitted[0]).toBe(`eip155:56:${net.identityRegistry}:777`);
    expect(toBlock).toBe(41_000_100);
  });

  it('is idempotent: same checkpoint range re-emits only new events', async () => {
    const store = new MemoryCheckpointStore();
    const first = await indexOnce({
      rpcUrl: 'http://fake',
      chainId: 56,
      checkpoint: store,
      batchSize: 200,
      toBlock: 41_000_100,
      probeImpl: async (u) => ({ url: u, status: 'up', checkedAt: '' }),
    });
    // Re-run should resume from checkpoint+1 -> 41_000_101 > toBlock(41_000_100) -> no scan
    const second = await indexOnce({
      rpcUrl: 'http://fake',
      chainId: 56,
      checkpoint: store,
      batchSize: 200,
      toBlock: 41_000_100,
      probeImpl: async (u) => ({ url: u, status: 'up', checkedAt: '' }),
    });
    expect(first.agents).toBe(1);
    expect(second.agents).toBe(0);
  });
});
