import { getNetwork, type RegisteredEvent } from '@ambit/erc8004';
import { describe, expect, it } from 'vitest';
import { eventToAgent } from '../src/indexer.js';

const network = getNetwork(56);
const observedAt = '2026-08-17T12:00:00.000Z';
const event: RegisteredEvent = {
  agentId: 42n,
  agentURI: 'data:application/json,fixture',
  owner: '0x1111111111111111111111111111111111111111',
  blockNumber: 42_000_000n,
  txHash: '0xcategory',
  logIndex: 0,
};

function registration(services: Array<{ name: string; endpoint: string }>) {
  return JSON.stringify({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Category agent',
    description: 'Valid registration metadata.',
    services,
    x402Support: false,
    active: true,
  });
}

describe('M11 indexer category provenance', () => {
  it('attaches a category and versioned classification evidence from valid metadata', () => {
    const agent = eventToAgent(
      event,
      network,
      registration([{ name: 'health-factor', endpoint: 'https://agent.example' }]),
      observedAt,
      null,
    );

    expect(agent.category).toBe('health-factor');
    expect(agent.evidenceRefs).toContainEqual({
      source: 'metadata-category-classification',
      timestamp: observedAt,
      blockNumber: Number(event.blockNumber),
      txHash: event.txHash,
      methodologyVersion: 'v2.0.0',
    });
  });

  it('records ambiguity without forcing a multi-purpose agent into one category', () => {
    const agent = eventToAgent(
      event,
      network,
      registration([
        { name: 'liquidity-rebalancing', endpoint: 'https://agent.example/monitor' },
        { name: 'yield-optimizer', endpoint: 'https://agent.example/yield' },
      ]),
      observedAt,
      null,
    );

    expect(agent.category).toBeNull();
    expect(
      agent.evidenceRefs.some((evidence) => evidence.source === 'metadata-category-ambiguous'),
    ).toBe(true);
  });

  it('does not classify malformed metadata even when it contains a category word', () => {
    const agent = eventToAgent(
      event,
      network,
      JSON.stringify({
        name: 'Monitoring agent',
        services: [{ name: 'liquidity-rebalancing', endpoint: 'https://agent.example' }],
      }),
      observedAt,
      null,
    );

    expect(agent.category).toBeNull();
    expect(agent.evidenceRefs.some((evidence) => evidence.source === 'metadata-validation')).toBe(
      true,
    );
    expect(
      agent.evidenceRefs.some((evidence) => evidence.source === 'metadata-category-classification'),
    ).toBe(false);
  });
});
