import type {
  AgentCategory,
  Confidence,
  EndpointStatus,
  Evidence,
  VerificationTier,
} from '@ambit/core';
import { isAddress, type Address, type Hex } from 'viem';

const AGENT_CATEGORIES = new Set<AgentCategory>([
  'rebalancing',
  'grid-trading',
  'health-factor',
  'yield',
]);
const VERIFICATION_TIERS = new Set<VerificationTier>([
  'unverified',
  'data-verified',
  'execution-verified',
]);
const CONFIDENCES = new Set<Confidence>(['none', 'low', 'medium', 'high']);
const ENDPOINT_STATUSES = new Set<EndpointStatus>(['unknown', 'up', 'down', 'degraded']);

export interface MarketplaceTrust {
  score: number;
  confidence: Confidence;
  methodologyVersion: string;
  computedAt: string;
  evidence: readonly Evidence[];
}

export interface MarketplaceEndpoint {
  url: string;
  status: EndpointStatus;
  lastChecked: string | null;
  latencyMs: number | null;
}

export interface MarketplaceAgentSummary {
  agentRegistry: string;
  agentId: string;
  chainId: number;
  identityRegistry: Address;
  owner: Address;
  agentWallet: Address | null;
  name: string;
  description: string;
  image: string | null;
  category: AgentCategory | null;
  capabilities: readonly string[];
  supportedProtocols: readonly string[];
  verificationTier: VerificationTier;
  supportedExecution: boolean;
  executionVerified: boolean;
  verifiedActivity: boolean;
  trust: MarketplaceTrust | null;
  endpoint: MarketplaceEndpoint | null;
  lastIndexedBlock: number | null;
  lastIndexedAt: string | null;
}

export interface MarketplaceReputationEvent {
  clientAddress: Address;
  value: string;
  valueDecimals: number;
  tag1: string | null;
  tag2: string | null;
  blockNumber: number;
  txHash: string;
  timestamp: string;
}

export interface MarketplaceActivityEvent {
  kind: string;
  blockNumber: number;
  txHash: string;
  timestamp: string;
}

export interface MarketplacePaymentEvidence {
  source: string;
  linkedTxHash: string | null;
  chainId: number | null;
  reliable: boolean;
  observedAt: string;
}

export interface MarketplacePolicy {
  maxTxValue: string | null;
  dailySpend: string | null;
  allowedTokens: readonly Address[];
  allowedProtocols: readonly string[];
  allowedTargets: readonly Address[];
  expiry: string | null;
  maxSlippageBps: number | null;
  minHealthFactor: string | null;
  createdAt: string;
}

export interface MarketplaceAgentProfile extends MarketplaceAgentSummary {
  agentURI: string;
  metadata: {
    source: string;
    blockNumber: number | null;
    txHash: string | null;
    timestamp: string;
  } | null;
  reputation: readonly MarketplaceReputationEvent[];
  activity: readonly MarketplaceActivityEvent[];
  walletActivity: {
    transactionCount: number;
    observedAtBlock: number;
    observedAt: string;
  } | null;
  payments: readonly MarketplacePaymentEvidence[];
  policy: MarketplacePolicy | null;
}

export interface ExecutionHistoryItem {
  id: string;
  clientRequestId: string | null;
  agentRegistry: string;
  requester: Address | null;
  destination: Address;
  protocol: string | null;
  requestedValue: string;
  requestStatus: string;
  policyResult: string;
  riskResult: string | null;
  simulationResult: string | null;
  approvalResult: string;
  rejectionReason: string | null;
  callsId: string | null;
  txHash: string | null;
  blockNumber: number | null;
  blockHash: string | null;
  executionStatus: string | null;
  gas: string | null;
  outcome: string | null;
  passportId: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface AgentSearchQuery {
  q?: string;
  category?: AgentCategory;
  verificationTier?: VerificationTier;
  supportedExecution?: boolean;
  protocol?: string;
  minTrustScore?: number;
  cursor?: string;
  limit: number;
}

export interface ExecutionListQuery {
  cursor?: string;
  limit: number;
}

export interface HireAgentInput {
  clientRequestId: string;
  requester: Address;
  destination: Address;
  protocol?: string;
  requestedValue: string;
  expiresAt: number;
  signature: Hex;
}

export interface PaginatedResult<T> {
  items: readonly T[];
  nextCursor: string | null;
}

export interface MarketplaceRepository {
  ready(): Promise<void>;
  listAgents(query: AgentSearchQuery): Promise<PaginatedResult<MarketplaceAgentSummary>>;
  getAgent(agentRegistry: string): Promise<MarketplaceAgentProfile | null>;
  createHire(agentRegistry: string, input: HireAgentInput): Promise<ExecutionHistoryItem>;
  listExecutions(
    agentRegistry: string,
    query: ExecutionListQuery,
  ): Promise<PaginatedResult<ExecutionHistoryItem>>;
}

export class MarketplaceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketplaceConflictError';
  }
}

export class MarketplaceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketplaceNotFoundError';
  }
}

export class MarketplaceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketplaceUnavailableError';
  }
}

export class RequestValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join('; '));
    this.name = 'RequestValidationError';
    this.issues = issues;
  }
}

export function parseAgentSearchQuery(query: Record<string, string>): AgentSearchQuery {
  const issues: string[] = [];
  const parsed: AgentSearchQuery = { limit: parseLimit(query.limit, 20, issues) };

  const q = normalizedOptional(query.q);
  if (q && q.length > 100) issues.push('q must be at most 100 characters');
  else if (q) parsed.q = q;

  if (query.category !== undefined) {
    if (!AGENT_CATEGORIES.has(query.category as AgentCategory)) issues.push('category is invalid');
    else parsed.category = query.category as AgentCategory;
  }
  if (query.verificationTier !== undefined) {
    if (!VERIFICATION_TIERS.has(query.verificationTier as VerificationTier)) {
      issues.push('verificationTier is invalid');
    } else parsed.verificationTier = query.verificationTier as VerificationTier;
  }
  if (query.supportedExecution !== undefined) {
    const value = parseBoolean(query.supportedExecution);
    if (value === undefined) issues.push('supportedExecution must be true or false');
    else parsed.supportedExecution = value;
  }

  const protocol = normalizedOptional(query.protocol);
  if (protocol && protocol.length > 64) issues.push('protocol must be at most 64 characters');
  else if (protocol) parsed.protocol = protocol;

  if (query.minTrustScore !== undefined) {
    const score = Number(query.minTrustScore);
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      issues.push('minTrustScore must be an integer from 0 to 100');
    } else parsed.minTrustScore = score;
  }

  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    if (!cursor || !isAgentRegistry(cursor)) issues.push('cursor is invalid');
    else parsed.cursor = cursor;
  }

  if (issues.length > 0) throw new RequestValidationError(issues);
  return parsed;
}

export function parseExecutionListQuery(query: Record<string, string>): ExecutionListQuery {
  const issues: string[] = [];
  const parsed: ExecutionListQuery = { limit: parseLimit(query.limit, 20, issues) };
  if (query.cursor !== undefined) {
    const cursor = decodeCursor(query.cursor);
    if (!cursor || !/^[A-Za-z0-9_-]+$/u.test(cursor)) issues.push('cursor is invalid');
    else parsed.cursor = cursor;
  }
  if (issues.length > 0) throw new RequestValidationError(issues);
  return parsed;
}

export function parseHireAgentInput(
  value: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): HireAgentInput {
  const issues: string[] = [];
  if (!isRecord(value)) throw new RequestValidationError(['request body must be an object']);

  const clientRequestId = normalizedOptional(value.clientRequestId);
  if (!clientRequestId) {
    issues.push('clientRequestId is required');
  } else if (clientRequestId.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(clientRequestId)) {
    issues.push('clientRequestId contains invalid characters or is too long');
  }
  if (!isNonZeroAddress(value.requester)) issues.push('requester must be a non-zero address');
  if (!isNonZeroAddress(value.destination)) issues.push('destination must be a non-zero address');

  const protocol = normalizedOptional(value.protocol);
  if (protocol && protocol.length > 64) issues.push('protocol must be at most 64 characters');
  if (!isCanonicalDecimal(value.requestedValue)) {
    issues.push('requestedValue must be a non-negative canonical decimal string');
  }
  if (
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= nowSeconds ||
    (value.expiresAt as number) > nowSeconds + 15 * 60
  ) {
    issues.push('expiresAt must be within the next 15 minutes');
  }
  if (typeof value.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/u.test(value.signature)) {
    issues.push('signature must be a 65-byte hex value');
  }

  if (issues.length > 0) throw new RequestValidationError(issues);
  return {
    clientRequestId: clientRequestId!,
    requester: value.requester as Address,
    destination: value.destination as Address,
    ...(protocol ? { protocol } : {}),
    requestedValue: value.requestedValue as string,
    expiresAt: value.expiresAt as number,
    signature: value.signature as Hex,
  };
}

export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function isAgentRegistry(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^eip155:[1-9][0-9]*:0x[0-9a-fA-F]{40}:(0|[1-9][0-9]*)$/u.test(value)
  );
}

export function isConfidence(value: unknown): value is Confidence {
  return typeof value === 'string' && CONFIDENCES.has(value as Confidence);
}

export function isEndpointStatus(value: unknown): value is EndpointStatus {
  return typeof value === 'string' && ENDPOINT_STATUSES.has(value as EndpointStatus);
}

export function isVerificationTier(value: unknown): value is VerificationTier {
  return typeof value === 'string' && VERIFICATION_TIERS.has(value as VerificationTier);
}

export function isAgentCategory(value: unknown): value is AgentCategory {
  return typeof value === 'string' && AGENT_CATEGORIES.has(value as AgentCategory);
}

function parseLimit(value: string | undefined, fallback: number, issues: string[]): number {
  if (value === undefined) return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    issues.push('limit must be an integer from 1 to 100');
    return fallback;
  }
  return limit;
}

function parseBoolean(value: string): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function decodeCursor(value: string): string | undefined {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function normalizedOptional(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isNonZeroAddress(value: unknown): value is Address {
  return typeof value === 'string' && isAddress(value) && !/^0x0{40}$/u.test(value);
}

function isCanonicalDecimal(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
