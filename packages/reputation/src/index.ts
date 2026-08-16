import { normalizeReputationValue, type NewFeedbackEvent } from '@ambit/erc8004';
import type { ReputationSummary } from '@ambit/core';

/**
 * Reputation normalization + quality signals (brief §6/§7).
 *
 * We DO NOT treat raw reputation as truth. We normalize the int128-scaled
 * values, count distinct clients (Sybil signal), and label freshness. The
 * trust engine (M3) consumes this. Nothing here fabricates coverage.
 */
export interface NormalizedFeedback {
  agentId: string;
  client: string;
  value: number;
  tag1: string | null;
  tag2: string | null;
  blockNumber: number;
  txHash: string;
}

export function normalizeFeedback(events: NewFeedbackEvent[]): NormalizedFeedback[] {
  return events.map((e) => ({
    agentId: e.agentId.toString(),
    client: e.clientAddress.toLowerCase(),
    value: normalizeReputationValue(e.value, e.valueDecimals),
    tag1: e.tag1,
    tag2: e.tag2,
    blockNumber: Number(e.blockNumber),
    txHash: e.txHash,
  }));
}

export function summarizeReputation(
  events: NormalizedFeedback[],
  nowIso: string,
): ReputationSummary {
  if (events.length === 0) {
    return { normalizedScore: 0, feedbackCount: 0, distinctClients: 0, lastUpdated: nowIso, freshness: 'stale' };
  }
  const clients = new Set(events.map((e) => e.client));
  const sum = events.reduce((acc, e) => acc + e.value, 0);
  // Freshness is set by the caller using block recency; default 'recent' here.
  return {
    normalizedScore: sum,
    feedbackCount: events.length,
    distinctClients: clients.size,
    lastUpdated: nowIso,
    freshness: 'recent',
  };
}

/**
 * Sybil / concentration signal: ratio of feedback volume attributable to the
 * single most-active client. High concentration is a WEAK-evidence flag, not a
 * verdict. Returns 0..1 (1 = all feedback from one client).
 */
export function reviewerConcentration(events: NormalizedFeedback[]): number {
  if (events.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.client, (counts.get(e.client) ?? 0) + 1);
  const max = Math.max(...counts.values());
  return max / events.length;
}

export function distinctClientRatio(events: NormalizedFeedback[]): number {
  if (events.length === 0) return 0;
  return new Set(events.map((e) => e.client)).size / events.length;
}
