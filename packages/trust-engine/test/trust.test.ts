import { describe, it, expect } from 'vitest';
import { scoreAgent, withTrust } from '../src/index.js';
import type { Agent } from '@ambit/core';

function baseAgent(over: Partial<Agent> = {}): Agent {
  return {
    agentRegistry: 'eip155:56:0xid:1',
    agentId: '1',
    chainId: 56,
    identityRegistry: '0xid',
    owner: '0xowner',
    agentURI: 'ipfs://x',
    name: 'A',
    description: '',
    category: null,
    capabilities: [],
    endpoint: null,
    reputation: null,
    paymentEvidence: [],
    verifiedActivity: false,
    trust: null,
    verificationTier: 'unverified',
    supportedExecution: false,
    supportedProtocols: [],
    executionVerified: false,
    executionStats: { verifiedExecutions: 0, blockedActions: 0, successRate: null, capitalProcessed: '0' },
    policy: null,
    evidenceRefs: [],
    lastIndexedBlock: 1,
    lastIndexedAt: '2026-08-16T00:00:00Z',
    ...over,
  };
}

describe('deterministic trust engine', () => {
  it('scores a zero-evidence agent low but NOT null (R-VIS: still discoverable)', () => {
    const r = scoreAgent(baseAgent());
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThan(40); // weak evidence => low score
    expect(r.tier).toBe('unverified');
    expect(r.confidence).toBe('none'); // but confidence reflects lack of evidence
  });

  it('is pure: same agent -> identical score', () => {
    const a = baseAgent({ reputation: { normalizedScore: 500, feedbackCount: 10, distinctClients: 8, lastUpdated: '', freshness: 'recent' }, endpoint: { url: 'https://x', status: 'up', lastChecked: '' } });
    expect(scoreAgent(a).score).toBe(scoreAgent(a).score);
  });

  it('rewards live endpoint + reputation + valid metadata', () => {
    const strong = baseAgent({
      reputation: { normalizedScore: 1200, feedbackCount: 12, distinctClients: 10, lastUpdated: '', freshness: 'recent' },
      endpoint: { url: 'https://x', status: 'up', lastChecked: '' },
      verifiedActivity: true,
    });
    const weak = baseAgent();
    expect(scoreAgent(strong).score).toBeGreaterThan(scoreAgent(weak).score);
    expect(scoreAgent(strong).tier).toBe('data-verified');
    expect(scoreAgent(strong).confidence).toBe('high');
  });

  it('penalizes Sybil-style single-reviewer concentration', () => {
    const diverse = baseAgent({ reputation: { normalizedScore: 800, feedbackCount: 10, distinctClients: 10, lastUpdated: '', freshness: 'recent' } });
    const concentrated = baseAgent({ reputation: { normalizedScore: 800, feedbackCount: 10, distinctClients: 1, lastUpdated: '', freshness: 'recent' } });
    expect(scoreAgent(diverse).breakdown.reputation.value).toBeGreaterThan(scoreAgent(concentrated).breakdown.reputation.value);
  });

  it('records metadata-validation failure as a low (not fabricated) signal', () => {
    const bad = baseAgent({ evidenceRefs: [{ source: 'metadata-validation', timestamp: '' }] });
    expect(scoreAgent(bad).breakdown.metadata.value).toBeLessThan(1);
    // still scored + discoverable
    expect(scoreAgent(bad).score).toBeGreaterThanOrEqual(0);
  });

  it('produces a human-readable breakdown for the marketplace', () => {
    const r = scoreAgent(baseAgent({ endpoint: { url: 'https://x', status: 'up', lastChecked: '' } }));
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(typeof r.breakdown.endpoint.contribution).toBe('number');
  });

  it('withTrust attaches an immutable TrustScore without mutating input', () => {
    const a = baseAgent();
    const scored = withTrust(a, scoreAgent(a));
    expect(scored.trust).not.toBeNull();
    expect(scored.trust?.score).toBe(scoreAgent(a).score);
    expect(a.trust).toBeNull(); // original untouched
  });
});
