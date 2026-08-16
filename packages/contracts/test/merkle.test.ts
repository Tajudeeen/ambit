import { describe, expect, it } from 'vitest';
import type { Agent } from '@ambit/core';
import {
  buildScoreMerkleTree,
  buildScoreSnapshot,
  hashEvidenceSet,
  hashMethodologyVersion,
  hashScoreLeaf,
  scoreClaimFromAgent,
  verifyScoreProof,
  type ScoreClaim,
} from '../src/merkle.js';

const METHODOLOGY = hashMethodologyVersion('v0.0.0');
const EVIDENCE = hashEvidenceSet([
  {
    source: 'trust-engine',
    timestamp: '2026-08-16T00:00:00.000Z',
    blockNumber: 41_000_100,
    methodologyVersion: 'v0.0.0',
  },
]);

function claim(agentId: bigint, score: number): ScoreClaim {
  return {
    chainId: 56n,
    identityRegistry: '0x0000000000000000000000000000000000000800',
    agentId,
    score,
    confidence: 3,
    verificationTier: 1,
    methodologyHash: METHODOLOGY,
    evidenceHash: EVIDENCE,
    observedAtBlock: 41_000_100n,
  };
}

describe('M4b Merkle score tooling', () => {
  it('is independent of input order and verifies every proof', () => {
    const claims = [claim(1n, 72), claim(2n, 48), claim(3n, 91)];
    const first = buildScoreMerkleTree(claims);
    const second = buildScoreMerkleTree([...claims].reverse());

    expect(second.root).toBe(first.root);
    for (const item of claims) {
      expect(verifyScoreProof(item, first.getProof(item), first.root)).toBe(true);
    }
  });

  it('duplicates odd nodes and rejects tampered claims', () => {
    const original = claim(7n, 67);
    const tree = buildScoreMerkleTree([original, claim(8n, 68), claim(9n, 69)]);
    const tampered = { ...original, score: 66 };

    expect(tree.getProof(original)).toHaveLength(2);
    expect(verifyScoreProof(original, tree.getProof(original), tree.root)).toBe(true);
    expect(verifyScoreProof(tampered, tree.getProof(original), tree.root)).toBe(false);
  });

  it('commits methodology, source block, leaves, and manifest', () => {
    const snapshot = buildScoreSnapshot([claim(1n, 72), claim(2n, 48)]);

    expect(snapshot.leafCount).toBe(2);
    expect(snapshot.sourceBlock).toBe(41_000_100n);
    expect(snapshot.methodologyHash).toBe(METHODOLOGY);
    expect(snapshot.manifestHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('maps a scored agent into the onchain claim shape', () => {
    const agent = {
      agentRegistry: 'eip155:56:0x0000000000000000000000000000000000000800:7',
      agentId: '7',
      chainId: 56,
      identityRegistry: '0x0000000000000000000000000000000000000800',
      owner: '0x0000000000000000000000000000000000000001',
      agentWallet: null,
      agentURI: 'data:application/json,{}',
      name: 'Agent',
      description: '',
      category: null,
      capabilities: [],
      endpoint: null,
      reputation: null,
      paymentEvidence: [],
      activity: null,
      verifiedActivity: false,
      trust: {
        score: 72,
        confidence: 'high',
        methodologyVersion: 'v0.0.0',
        evidence: [],
      },
      verificationTier: 'data-verified',
      supportedExecution: false,
      supportedProtocols: [],
      executionVerified: false,
      executionStats: {
        verifiedExecutions: 0,
        blockedActions: 0,
        successRate: null,
        capitalProcessed: '0',
      },
      policy: null,
      evidenceRefs: [],
      lastIndexedBlock: 41_000_100,
      lastIndexedAt: '2026-08-16T00:00:00.000Z',
    } satisfies Agent;

    expect(scoreClaimFromAgent(agent, 41_000_100n)).toMatchObject({
      agentId: 7n,
      score: 72,
      confidence: 3,
      verificationTier: 1,
      observedAtBlock: 41_000_100n,
    });
  });

  it('rejects invalid scores and mixed snapshot metadata', () => {
    expect(() => hashScoreLeaf(claim(1n, 101))).toThrow('0 to 100');
    expect(() =>
      hashScoreLeaf({ ...claim(1n, 10), confidence: 4 as ScoreClaim['confidence'] }),
    ).toThrow('0 to 3');
    expect(() =>
      buildScoreSnapshot([claim(1n, 10), { ...claim(2n, 20), observedAtBlock: 41_000_101n }]),
    ).toThrow('observation block');
  });
});
