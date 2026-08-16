import { describe, it, expect } from 'vitest';
import { normalizeFeedback, summarizeReputation, reviewerConcentration, distinctClientRatio } from '../src/index.js';
import type { NewFeedbackEvent } from '@ambit/erc8004';

function fb(over: Partial<NewFeedbackEvent> = {}): NewFeedbackEvent {
  return {
    agentId: 1n,
    clientAddress: '0xabc0000000000000000000000000000000000abc',
    value: 100n,
    valueDecimals: 0,
    tag1: null,
    tag2: null,
    endpoint: null,
    feedbackURI: null,
    feedbackHash: '0xhash',
    blockNumber: 41_000_000n,
    txHash: '0xtx',
    logIndex: 0,
    ...over,
  };
}

describe('reputation normalization', () => {
  it('normalizes int128-scaled values', () => {
    const norm = normalizeFeedback([fb({ value: 250n, valueDecimals: 1 })]);
    expect(norm[0].value).toBe(25);
  });

  it('summarizes feedback count + distinct clients', () => {
    const events = [
      fb({ clientAddress: '0xaaa' }),
      fb({ clientAddress: '0xaaa' }),
      fb({ clientAddress: '0xbbb' }),
    ];
    const s = summarizeReputation(normalizeFeedback(events), '2026-08-16T00:00:00Z');
    expect(s.feedbackCount).toBe(3);
    expect(s.distinctClients).toBe(2);
    expect(s.normalizedScore).toBe(300);
  });

  it('flags reviewer concentration as a weak-evidence signal (not a verdict)', () => {
    const allSame = [fb({ clientAddress: '0xaaa' }), fb({ clientAddress: '0xaaa' })];
    const diverse = [fb({ clientAddress: '0xaaa' }), fb({ clientAddress: '0xbbb' })];
    expect(reviewerConcentration(normalizeFeedback(allSame))).toBe(1);
    expect(reviewerConcentration(normalizeFeedback(diverse))).toBe(0.5);
    expect(distinctClientRatio(normalizeFeedback(diverse))).toBe(1);
  });

  it('handles zero feedback without dividing by zero', () => {
    expect(summarizeReputation([], '2026-08-16T00:00:00Z').feedbackCount).toBe(0);
    expect(reviewerConcentration([])).toBe(0);
    expect(distinctClientRatio([])).toBe(0);
  });
});
