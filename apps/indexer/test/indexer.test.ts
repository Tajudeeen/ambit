import { describe, it, expect } from 'vitest';
import { MemoryCheckpointStore, nextStartBlock } from '../src/checkpoint.js';
import { getNetwork } from '@ambit/erc8004';
import { eventToAgent } from '../src/indexer.js';
import type { RegisteredEvent } from '@ambit/erc8004';

const net = getNetwork(56);

describe('checkpoint store', () => {
  it('returns null when no checkpoint exists', async () => {
    const s = new MemoryCheckpointStore();
    expect(await s.get(56, net.identityRegistry)).toBeNull();
  });

  it('persists and resumes from checkpoint (deterministic)', async () => {
    const s = new MemoryCheckpointStore();
    await s.save(56, net.identityRegistry, 41_500_000);
    expect(await s.get(56, net.identityRegistry)).toBe(41_500_000);
    // nextStartBlock resumes at checkpoint+1
    expect(nextStartBlock(net, net.identityRegistry, 41_500_000)).toBe(41_500_001);
  });

  it('falls back to registry deployment block when no checkpoint', () => {
    expect(nextStartBlock(net, net.identityRegistry, null)).toBe(net.registryDeployedAtBlock);
  });
});

describe('eventToAgent (canonical model seed)', () => {
  const ev: RegisteredEvent = {
    agentId: 123n,
    agentURI: 'ipfs://bafyagent123',
    owner: '0x1111111111111111111111111111111111111111',
    blockNumber: 42_000_000n,
    txHash: '0xabc123',
    logIndex: 0,
  };

  it('seeds a discoverable, unverified agent from a Registered event', () => {
    const json = JSON.stringify({
      name: 'YieldBot',
      description: 'Optimizes yield',
      services: [{ name: 'yield', endpoint: 'https://yield.bot/api' }],
    });
    const a = eventToAgent(ev, net, json, '2026-08-16T00:00:00Z');
    expect(a.agentRegistry).toBe(`eip155:56:${net.identityRegistry}:123`);
    expect(a.name).toBe('YieldBot');
    expect(a.capabilities).toEqual(['yield']);
    expect(a.endpoint?.url).toBe('https://yield.bot/api');
    // CRITICAL: never gate visibility. New agent is discoverable but unverified.
    expect(a.verificationTier).toBe('unverified');
    expect(a.trust).toBeNull();
    expect(a.evidenceRefs[0]?.txHash).toBe('0xabc123');
    expect(a.lastIndexedBlock).toBe(42_000_000);
  });

  it('records malformed metadata without fabricating fields', () => {
    const a = eventToAgent(ev, net, 'not json{', '2026-08-16T00:00:00Z');
    expect(a.name).toBe('Agent 123');
    expect(a.description).toBe('');
    expect(a.capabilities).toEqual([]);
  });
});
