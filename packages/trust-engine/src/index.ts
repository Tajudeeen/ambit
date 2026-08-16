import type { Agent, Confidence, Evidence, TrustScore, VerificationTier } from '@ambit/core';
import { METHODOLOGY_VERSION } from '@ambit/core';

/**
 * DETERMINISTIC TRUST ENGINE (brief §8).
 *
 * Design contract:
 *  - PURE + REPRODUCIBLE: same Agent -> same score. No RNG, no clocks in math.
 *  - NEVER A VISIBILITY GATE (R-VIS): every agent is scored, including
 *    weak-evidence agents. Low evidence => low score + low confidence, but the
 *    agent stays discoverable. The marketplace MUST NOT hide low-tiered agents.
 *  - TRANSPARENT: `scoreAgent` returns a full per-signal breakdown so the UI can
 *    explain *why* (credibility + TermiX "Agent Advantage Report").
 *  - CONFIDENCE != SCORE: confidence reflects how much evidence we have, not how
 *    good the agent is. A 0-score agent with strong evidence is "confidently bad".
 *
 * The LLM (M-later) may NARRATE a score; it never computes or overrides it.
 * The deterministic engine is authoritative.
 */

export interface SignalBreakdown {
  /** Each signal: raw sub-score 0..1, weight, weighted contribution 0..weight. */
  identity: SubScore;
  metadata: SubScore;
  endpoint: SubScore;
  reputation: SubScore;
  activity: SubScore;
}

export interface SubScore {
  value: number; // 0..1
  weight: number;
  contribution: number; // value * weight
  detail: string;
}

export interface TrustResult {
  score: number; // 0..100, rounded
  confidence: Confidence;
  tier: VerificationTier;
  breakdown: SignalBreakdown;
  /** Human-readable reasons, highest-impact first. For marketplace + audit. */
  reasons: string[];
  methodologyVersion: string;
  evidence: Evidence[];
}

// Weights sum to 1.0. Identity + metadata are table-stakes; reputation + endpoint
// are the differentiators; activity is a liveness bonus.
const WEIGHTS = {
  identity: 0.15,
  metadata: 0.15,
  endpoint: 0.2,
  reputation: 0.4,
  activity: 0.1,
} as const;

/** Saturate a number into [0,1]. */
function sat(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function sub(value: number, weight: number, detail: string): SubScore {
  const v = sat(value);
  return { value: v, weight, contribution: v * weight, detail };
}

/** Identity signal: an on-chain ERC-8004 registration is always present => 1. */
function identitySignal(agent: Agent): SubScore {
  const present = Boolean(agent.agentRegistry && agent.owner);
  return sub(present ? 1 : 0, WEIGHTS.identity, present ? 'on-chain ERC-8004 identity registered' : 'no on-chain identity');
}

/** Metadata signal: valid registration file => 1, malformed => 0.15 (recorded, not fabricated). */
function metadataSignal(agent: Agent): SubScore {
  const valid = !agent.evidenceRefs.some((e) => e.source === 'metadata-validation');
  return sub(valid ? 1 : 0.15, WEIGHTS.metadata, valid ? 'metadata validates against ERC-8004 schema' : 'metadata failed schema validation');
}

/** Endpoint signal: live => 1, degraded => 0.5, down/unknown => 0. SSRF-blocked => 0. */
function endpointSignal(agent: Agent): SubScore {
  switch (agent.endpoint?.status) {
    case 'up':
      return sub(1, WEIGHTS.endpoint, `endpoint live (${agent.endpoint.latencyMs ?? '?'}ms)`);
    case 'degraded':
      return sub(0.5, WEIGHTS.endpoint, 'endpoint reachable but degraded');
    case 'down':
      return sub(0, WEIGHTS.endpoint, 'endpoint down or SSRF-blocked');
    default:
      return sub(0, WEIGHTS.endpoint, 'no endpoint / not probed');
  }
}

/**
 * Reputation signal: normalized score scaled by coverage, with Sybil
 * concentration penalty. We DO NOT treat raw reputation as truth (brief §7).
 *  - base = sat(normalizedScore / REP_SCALE)  // high reputation -> closer to 1
 *  - coverage = sat(feedbackCount / MIN_FEEDBACK) // need volume before trusting
 *  - concentration penalty: single-reviewer dominance reduces signal
 */
function reputationSignal(agent: Agent): SubScore {
  const rep = agent.reputation;
  if (!rep || rep.feedbackCount === 0) {
    return sub(0, WEIGHTS.reputation, 'no on-chain reputation feedback');
  }
  const REP_SCALE = 1000; // a normalized cumulative score of 1000+ => full marks
  const MIN_FEEDBACK = 5; // <5 feedbacks => low coverage confidence
  const base = sat(rep.normalizedScore / REP_SCALE);
  const coverage = sat(rep.feedbackCount / MIN_FEEDBACK);
  // Use distinct-client breadth: 1 reviewer -> 0 diversity, many -> up to 1.
  const diversity = distinctClientRatioFrom(rep.distinctClients, rep.feedbackCount);
  const penalized = base * coverage * (0.5 + 0.5 * diversity);
  return sub(
    penalized,
    WEIGHTS.reputation,
    `reputation ${rep.normalizedScore.toFixed(0)} from ${rep.feedbackCount} feedback(s), ${rep.distinctClients} distinct reviewer(s)`,
  );
}

/** diversity in [0,1]: 1 reviewer => 0, many distinct => up to 1. */
function distinctClientRatioFrom(distinct: number, total: number): number {
  if (total <= 0) return 0;
  // reward breadth: 1/1=1 (single reviewer, no diversity) ... ratio climbs with distinct count
  return sat((distinct - 1) / Math.max(1, Math.min(total, 10) - 1));
}

/** Activity signal: verifiedActivity flag (M2/M4) => 1, else 0. */
function activitySignal(agent: Agent): SubScore {
  return sub(agent.verifiedActivity ? 1 : 0, WEIGHTS.activity, agent.verifiedActivity ? 'verified on-chain activity' : 'no verified activity yet');
}

/** Confidence: how much EVIDENCE we have, independent of score quality.
 * Table-stakes (identity/metadata) is NOT counted — confidence reflects
 * trust-relevant evidence only, so a weak agent reads 'none'. */
function confidenceFor(agent: Agent, breakdown: SignalBreakdown): Confidence {
  let points = 0;
  if (agent.reputation && agent.reputation.feedbackCount >= 1) points++;
  if (agent.reputation && agent.reputation.distinctClients >= 3) points++;
  if (agent.endpoint?.status === 'up') points++;
  if (agent.verifiedActivity) points++;
  void breakdown;
  if (points >= 4) return 'high';
  if (points >= 2) return 'medium';
  if (points >= 1) return 'low';
  return 'none';
}

/** Tier assignment (NOT a visibility gate — all tiers remain discoverable). */
function tierFor(result: TrustResult): VerificationTier {
  if (result.score >= 60 && result.confidence !== 'none') return 'data-verified';
  // execution-verified is assigned by the Altana adapter layer (M7), not here.
  return 'unverified';
}

export function scoreAgent(agent: Agent): TrustResult {
  const identity = identitySignal(agent);
  const metadata = metadataSignal(agent);
  const endpoint = endpointSignal(agent);
  const reputation = reputationSignal(agent);
  const activity = activitySignal(agent);

  const breakdown: SignalBreakdown = { identity, metadata, endpoint, reputation, activity };
  const raw = identity.contribution + metadata.contribution + endpoint.contribution + reputation.contribution + activity.contribution;
  const score = Math.round(sat(raw) * 100);

  const confidence = confidenceFor(agent, breakdown);
  const tier = tierFor({ score, confidence, tier: 'unverified', breakdown, reasons: [], methodologyVersion: METHODOLOGY_VERSION, evidence: [] });

  const reasons = buildReasons(breakdown, tier);

  const evidence: Evidence[] = [
    { source: 'trust-engine', timestamp: new Date().toISOString(), methodologyVersion: METHODOLOGY_VERSION },
  ];

  return { score, confidence, tier, breakdown, reasons, methodologyVersion: METHODOLOGY_VERSION, evidence };
}

function buildReasons(b: SignalBreakdown, tier: VerificationTier): string[] {
  const out: string[] = [];
  if (b.reputation.value > 0) out.push(`On-chain reputation: ${b.reputation.detail}`);
  if (b.endpoint.value >= 1) out.push(`Endpoint verified live`);
  else if (b.endpoint.value === 0 && b.endpoint.detail !== 'no endpoint / not probed') out.push(`Endpoint issue: ${b.endpoint.detail}`);
  if (b.metadata.value < 1) out.push(`Metadata concern: ${b.metadata.detail}`);
  if (tier === 'data-verified') out.push('Qualifies as data-verified (sufficient evidence)');
  else out.push('Insufficient evidence for data-verified tier — discoverable but low confidence');
  return out;
}

/** Attach a computed TrustScore + tier onto an Agent (immutable update). */
export function withTrust(agent: Agent, result: TrustResult): Agent {
  const trust: TrustScore = {
    score: result.score,
    confidence: result.confidence,
    methodologyVersion: result.methodologyVersion,
    evidence: result.evidence,
  };
  return { ...agent, trust, verificationTier: result.tier };
}
