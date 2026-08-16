/**
 * Canonical internal agent model (M0 baseline, see brief §4).
 *
 * Every derived value MUST be traceable to a source with provenance.
 * See `Evidence` for the provenance envelope attached to derived fields.
 */

/** The four reference categories mandated by the BNB hackathon brief. */
export type AgentCategory = 'monitoring' | 'grid-trading' | 'health-factor' | 'yield';

/**
 * Verification tier. THIS IS NOT A VISIBILITY GATE.
 * A weak-evidence agent stays discoverable; it simply sits at a lower tier
 * with a low trust score and low confidence. (See ARCHITECTURE.md rule R-VIS.)
 */
export type VerificationTier = 'unverified' | 'data-verified' | 'execution-verified';

export type Confidence = 'none' | 'low' | 'medium' | 'high';

export type EndpointStatus = 'unknown' | 'up' | 'down' | 'degraded';

/** Provenance envelope for any derived/indexed value. */
export interface Evidence {
  /** Where the value came from: 'erc8004-identity' | 'erc8004-reputation' | 'endpoint-probe' | 'altana' | 'pancakeswap' | 'x402' | ... */
  source: string;
  /** ISO-8601 timestamp the evidence was observed. */
  timestamp: string;
  /** Block number the evidence was observed at, when on-chain. */
  blockNumber?: number;
  /** Transaction hash the evidence was derived from, when applicable. */
  txHash?: string;
  /** Methodology/version that produced this evidence. */
  methodologyVersion?: string;
}

export interface EndpointState {
  url: string;
  status: EndpointStatus;
  lastChecked: string;
  latencyMs?: number;
}

export interface ReputationSummary {
  /** Raw cumulative reputation value (int128 scaled by valueDecimals), normalized. */
  normalizedScore: number;
  feedbackCount: number;
  /** Distinct clients that submitted feedback (Sybil signal). */
  distinctClients: number;
  lastUpdated: string;
  freshness: 'stale' | 'recent' | 'fresh';
}

export interface PaymentEvidence {
  source: 'x402' | 'other';
  linkedTxHash?: string;
  chainId?: number;
  observedAt: string;
  /** Whether payment linkage is reliably queryable. */
  reliable: boolean;
}

export interface WalletActivitySummary {
  /** Number of transactions sent by the registered wallet at observedAtBlock. */
  transactionCount: number;
  /** Chain block used for the wallet and transaction-count snapshot. */
  observedAtBlock: number;
  /** ISO-8601 time the indexer observed the snapshot. */
  observedAt: string;
}

export interface TrustScore {
  /** 0-100 reproducible score. */
  score: number;
  confidence: Confidence;
  methodologyVersion: string;
  evidence: Evidence[];
}

export interface Agent {
  /** eip155:{chainId}:{identityRegistry}:{agentId} */
  agentRegistry: string;
  agentId: string;
  chainId: number;
  identityRegistry: string;
  owner: string;
  agentWallet: string | null;
  agentURI: string;
  name: string;
  description: string;
  image?: string;
  category: AgentCategory | null;
  capabilities: string[];
  endpoint: EndpointState | null;
  reputation: ReputationSummary | null;
  paymentEvidence: PaymentEvidence[];
  activity: WalletActivitySummary | null;
  verifiedActivity: boolean;
  trust: TrustScore | null;
  verificationTier: VerificationTier;
  supportedExecution: boolean;
  supportedProtocols: string[];
  executionVerified: boolean;
  executionStats: {
    verifiedExecutions: number;
    blockedActions: number;
    successRate: number | null;
    capitalProcessed: string;
  };
  policy: Record<string, unknown> | null;
  evidenceRefs: Evidence[];
  lastIndexedBlock: number | null;
  lastIndexedAt: string | null;
}
