export type AgentCategory = 'monitoring' | 'grid-trading' | 'health-factor' | 'yield';
export type VerificationTier = 'unverified' | 'data-verified' | 'execution-verified';
export type Confidence = 'none' | 'low' | 'medium' | 'high';
export type EndpointStatus = 'unknown' | 'up' | 'down' | 'degraded';

export interface MarketplaceTrust {
  score: number;
  confidence: Confidence;
  methodologyVersion: string;
  computedAt: string;
  evidence: readonly {
    source: string;
    timestamp: string;
    blockNumber?: number;
    txHash?: string;
    methodologyVersion?: string;
  }[];
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
  identityRegistry: string;
  owner: string;
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

export interface MarketplaceAgentProfile extends MarketplaceAgentSummary {
  agentURI: string;
  metadata: {
    source: string;
    blockNumber: number | null;
    txHash: string | null;
    timestamp: string;
  } | null;
  reputation: readonly {
    clientAddress: string;
    value: string;
    valueDecimals: number;
    tag1: string | null;
    tag2: string | null;
    blockNumber: number;
    txHash: string;
    timestamp: string;
  }[];
  activity: readonly {
    kind: string;
    blockNumber: number;
    txHash: string;
    timestamp: string;
  }[];
  payments: readonly {
    source: string;
    linkedTxHash: string | null;
    chainId: number | null;
    reliable: boolean;
    observedAt: string;
  }[];
  policy: {
    maxTxValue: string | null;
    dailySpend: string | null;
    allowedTokens: readonly string[];
    allowedProtocols: readonly string[];
    allowedTargets: readonly string[];
    expiry: string | null;
    maxSlippageBps: number | null;
    minHealthFactor: string | null;
    createdAt: string;
  } | null;
}

export interface ExecutionHistoryItem {
  id: string;
  clientRequestId: string | null;
  agentRegistry: string;
  requester: string | null;
  destination: string;
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

export interface AgentSearchInput {
  q?: string;
  category?: string;
  verificationTier?: string;
  supportedExecution?: string;
  protocol?: string;
  minTrustScore?: string;
  cursor?: string;
  limit?: string;
}

export interface PaginatedResult<T> {
  items: readonly T[];
  nextCursor: string | null;
}

export class MarketplaceApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: readonly string[];

  constructor(status: number, code: string, message: string, issues: readonly string[] = []) {
    super(message);
    this.name = 'MarketplaceApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export function marketplaceApiUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/+$/u, '');
}

export async function searchAgents(
  input: AgentSearchInput,
): Promise<PaginatedResult<MarketplaceAgentSummary>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value) query.set(key, value);
  }
  return requestJson(`/agents${query.size > 0 ? `?${query}` : ''}`);
}

export async function getAgent(agentRegistry: string): Promise<MarketplaceAgentProfile | null> {
  try {
    const result = await requestJson<{ agent: MarketplaceAgentProfile }>(
      `/agents/${encodeURIComponent(agentRegistry)}`,
    );
    return result.agent;
  } catch (error) {
    if (error instanceof MarketplaceApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getExecutions(
  agentRegistry: string,
): Promise<PaginatedResult<ExecutionHistoryItem>> {
  return requestJson(`/agents/${encodeURIComponent(agentRegistry)}/executions?limit=20`);
}

async function requestJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${marketplaceApiUrl()}${path}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new MarketplaceApiError(
      503,
      'repository-unavailable',
      'Marketplace data is unavailable.',
    );
  }

  const body = await parseJson(response);
  if (!response.ok) {
    const error = errorBody(body);
    throw new MarketplaceApiError(response.status, error.code, error.message, error.issues);
  }
  return body as T;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MarketplaceApiError(503, 'invalid-upstream', 'Marketplace data is unavailable.');
  }
}

function errorBody(value: unknown): { code: string; message: string; issues: readonly string[] } {
  if (!isRecord(value) || !isRecord(value.error)) {
    return { code: 'upstream-error', message: 'Marketplace request failed.', issues: [] };
  }
  return {
    code: typeof value.error.code === 'string' ? value.error.code : 'upstream-error',
    message:
      typeof value.error.message === 'string' ? value.error.message : 'Marketplace request failed.',
    issues: Array.isArray(value.error.issues)
      ? value.error.issues.filter((issue): issue is string => typeof issue === 'string')
      : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
