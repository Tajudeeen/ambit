import { describe, it, expect, vi } from 'vitest';
import { MemoryCheckpointStore } from '../src/checkpoint.js';
import { indexOnce } from '../src/indexer.js';
import { getNetwork, type RegisteredEvent } from '@ambit/erc8004';
import type { PublicClient } from 'viem';

const net = getNetwork(56);
const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;

// Fake viem client supporting everything indexOnce touches for M4:
// getBlockNumber, getContractEvents
// (Registered + NewFeedback), readContract (getAgentWallet).
function fakeClient(events: RegisteredEvent[], wallet: `0x${string}` | null): PublicClient {
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
    readContract: async (req: { functionName?: string }) => {
      if (req.functionName === 'getAgentWallet') return wallet;
      return null;
    },
  } as unknown as PublicClient;
}

vi.mock('@ambit/erc8004', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ambit/erc8004')>();
  return {
    ...mod,
    createBscClient: () =>
      fakeClient(
        [
          {
            agentId: 777n,
            agentURI:
              'data:application/json,' +
              encodeURIComponent(
                JSON.stringify({
                  name: 'ActiveBot',
                  services: [{ name: 'm', endpoint: 'https://live.bot' }],
                }),
              ),
            owner: '0x2222222222222222222222222222222222222222',
            blockNumber: 41_000_050n,
            txHash: '0xdeadbeef',
            logIndex: 0,
          },
        ],
        WALLET,
      ),
  };
});

describe('M4 on-chain activity verification (integration)', () => {
  it('captures agentWallet and transaction-count evidence without execution claims', async () => {
    const emitted: unknown[] = [];
    await indexOnce({
      rpcUrl: 'http://fake',
      chainId: 56,
      checkpoint: new MemoryCheckpointStore(),
      batchSize: 200,
      toBlock: 41_000_100,
      probeImpl: async (u) => ({ url: u, status: 'up', checkedAt: '' }),
      activityClient: { getTransactionCount: async () => 9 },
      onAgent: (a) => emitted.push(a),
    });
    const a = emitted[0] as {
      agentWallet: string | null;
      activity: { transactionCount: number; observedAtBlock: number } | null;
      verifiedActivity: boolean;
      executionStats: { verifiedExecutions: number; successRate: number | null };
    };
    expect(a.agentWallet).toBe(WALLET);
    expect(a.verifiedActivity).toBe(true);
    expect(a.activity).toMatchObject({ transactionCount: 9, observedAtBlock: 41_000_100 });
    expect(a.executionStats.verifiedExecutions).toBe(0);
    expect(a.executionStats.successRate).toBeNull();
  });

  it('does not claim activity for a wallet with zero txs (no fabrication)', async () => {
    const emitted: unknown[] = [];
    await indexOnce({
      rpcUrl: 'http://fake',
      chainId: 56,
      checkpoint: new MemoryCheckpointStore(),
      batchSize: 200,
      toBlock: 41_000_100,
      probeImpl: async (u) => ({ url: u, status: 'up', checkedAt: '' }),
      activityClient: { getTransactionCount: async () => 0 },
      onAgent: (a) => emitted.push(a),
    });
    const a = emitted[0] as {
      activity: { transactionCount: number } | null;
      verifiedActivity: boolean;
    };
    expect(a.verifiedActivity).toBe(false);
    expect(a.activity?.transactionCount).toBe(0);
  });

  it('keeps the agent discoverable when activity RPC evidence is unavailable', async () => {
    const emitted: Array<{ verifiedActivity: boolean; evidenceRefs: Array<{ source: string }> }> =
      [];
    const result = await indexOnce({
      rpcUrl: 'http://fake',
      chainId: 56,
      checkpoint: new MemoryCheckpointStore(),
      batchSize: 200,
      toBlock: 41_000_100,
      probeImpl: async (u) => ({ url: u, status: 'up', checkedAt: '' }),
      activityClient: {
        getTransactionCount: async () => Promise.reject(new Error('RPC unavailable')),
      },
      onAgent: (agent) => emitted.push(agent),
    });
    expect(result.agents).toBe(1);
    expect(emitted[0].verifiedActivity).toBe(false);
    expect(emitted[0].evidenceRefs.some((e) => e.source === 'onchain-activity-unavailable')).toBe(
      true,
    );
  });
});
