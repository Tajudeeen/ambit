import { describe, it, expect, vi } from 'vitest';
import { MemoryCheckpointStore, nextStartBlock } from '../src/checkpoint.js';
import { eventToAgent, buildReputationMap, indexOnce } from '../src/indexer.js';
import { getNetwork, type RegisteredEvent, type NewFeedbackEvent } from '@ambit/erc8004';
import type { PublicClient } from 'viem';

const net = getNetwork(56);

describe('checkpoint store', () => {
  it('returns null when no checkpoint exists', async () => {
    const s = new MemoryCheckpointStore();
    expect(await s.get(56, net.identityRegistry)).toBeNull();
  });
  it('resumes at checkpoint+1', async () => {
    const s = new MemoryCheckpointStore();
    await s.save(56, net.identityRegistry, 41_500_000);
    expect(nextStartBlock(net, net.identityRegistry, 41_500_000)).toBe(41_500_001);
  });
  it('falls back to registry deployment block', () => {
    expect(nextStartBlock(net, net.identityRegistry, null)).toBe(net.registryDeployedAtBlock);
  });
});

describe('eventToAgent M2 enrichment', () => {
  const ev: RegisteredEvent = {
    agentId: 123n,
    agentURI: 'ipfs://bafy',
    owner: '0x1111111111111111111111111111111111111111',
    blockNumber: 42_000_000n,
    txHash: '0xabc123',
    logIndex: 0,
  };

  it('validates metadata and records malformed metadata without fabricating', () => {
    const a = eventToAgent(ev, net, 'not json{', '2026-08-16T00:00:00Z', null);
    expect(a.name).toBe('Agent 123');
    expect(a.evidenceRefs.some((e) => e.source === 'metadata-validation')).toBe(true);
    expect(a.verificationTier).toBe('unverified'); // R-VIS: still discoverable
  });

  it('attaches endpoint status from SSRF-safe probe', () => {
    const a = eventToAgent(
      ev,
      net,
      JSON.stringify({
        name: 'Bot',
        services: [{ name: 'm', endpoint: 'https://bot.example/api' }],
      }),
      '2026-08-16T00:00:00Z',
      {
        url: 'https://bot.example/api',
        status: 'up',
        latencyMs: 42,
        checkedAt: '2026-08-16T00:00:00Z',
      },
    );
    expect(a.endpoint?.status).toBe('up');
    expect(a.endpoint?.latencyMs).toBe(42);
  });

  it('flags SSRF-blocked endpoints as down, not hidden', () => {
    const a = eventToAgent(
      ev,
      net,
      JSON.stringify({
        name: 'Bad',
        services: [{ name: 'm', endpoint: 'http://169.254.169.254/x' }],
      }),
      '2026-08-16T00:00:00Z',
      {
        url: 'http://169.254.169.254/x',
        status: 'blocked',
        reason: 'blocked IP',
        checkedAt: '2026-08-16T00:00:00Z',
      },
    );
    expect(a.endpoint?.status).toBe('down');
    expect(a.evidenceRefs.some((e) => e.source === 'endpoint-ssrf-blocked')).toBe(true);
  });
});

describe('buildReputationMap', () => {
  it('groups normalized feedback by agent and attaches summary', () => {
    const fb: NewFeedbackEvent = {
      agentId: 123n,
      clientAddress: '0xaaa',
      value: 50n,
      valueDecimals: 0,
      tag1: null,
      tag2: null,
      endpoint: null,
      feedbackURI: null,
      feedbackHash: '0xh',
      blockNumber: 42_000_000n,
      txHash: '0xt',
      logIndex: 0,
    };
    const m = buildReputationMap([fb, { ...fb, value: 70n }], '2026-08-16T00:00:00Z');
    const s = m.get('123');
    expect(s?.feedbackCount).toBe(2);
    expect(s?.normalizedScore).toBe(120);
    expect(s?.distinctClients).toBe(1);
  });
});

// Hermetic viem client returning one real-shaped Registered event + one feedback.
function fakeClient(events: RegisteredEvent[], feedback: NewFeedbackEvent[]): PublicClient {
  return {
    getBlockNumber: async () => 41_000_100n,
    getContractEvents: async (req: { eventName?: string }) =>
      req.eventName === 'NewFeedback'
        ? feedback.map((e) => ({
            args: e,
            blockNumber: e.blockNumber,
            transactionHash: e.txHash,
            logIndex: e.logIndex,
          }))
        : events.map((e) => ({
            args: { agentId: e.agentId, agentURI: e.agentURI, owner: e.owner },
            blockNumber: e.blockNumber,
            transactionHash: e.txHash,
            logIndex: e.logIndex,
          })),
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
                  name: 'LiveBot',
                  services: [{ name: 'liquidity-rebalancing', endpoint: 'https://live.bot' }],
                }),
              ),
            owner: '0x2222222222222222222222222222222222222222',
            blockNumber: 41_000_050n,
            txHash: '0xdeadbeef',
            logIndex: 0,
          },
        ],
        [
          {
            agentId: 777n,
            clientAddress: '0xfeed',
            value: 80n,
            valueDecimals: 0,
            tag1: null,
            tag2: null,
            endpoint: null,
            feedbackURI: null,
            feedbackHash: '0xfb',
            blockNumber: 41_000_050n,
            txHash: '0xfbtx',
            logIndex: 0,
          },
        ],
      ),
  };
});

describe('indexOnce M2 integration (hermetic)', () => {
  it('emits a discoverable agent with metadata + reputation + endpoint status', async () => {
    const emitted: unknown[] = [];
    const { agents } = await indexOnce({
      rpcUrl: 'http://fake',
      chainId: 56,
      checkpoint: new MemoryCheckpointStore(),
      batchSize: 200,
      toBlock: 41_000_100,
      probeImpl: async (url) => ({
        url,
        status: 'up',
        latencyMs: 10,
        checkedAt: '2026-08-16T00:00:00Z',
      }),
      onAgent: (a) => emitted.push(a),
    });
    expect(agents).toBe(1);
    const a = emitted[0] as {
      name: string;
      reputation: { feedbackCount: number } | null;
      endpoint: { status: string } | null;
    };
    expect(a.name).toBe('LiveBot');
    expect(a.reputation?.feedbackCount).toBe(1); // reputation ingested
    expect(a.endpoint?.status).toBe('up'); // endpoint probed (SSRF-safe)
  });

  it('is idempotent on re-run', async () => {
    const store = new MemoryCheckpointStore();
    const first = await indexOnce({
      rpcUrl: 'http://fake',
      chainId: 56,
      checkpoint: store,
      batchSize: 200,
      toBlock: 41_000_100,
      probeImpl: async (u) => ({ url: u, status: 'up', checkedAt: '' }),
    });
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
