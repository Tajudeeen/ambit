export const TERMIX_INTEGRATION_VERSION = 'v1.0.0' as const;
export const TERMIX_PUBLIC_API_URL = 'https://termix-backend.dev.termix.click/api/v1' as const;

export type TermixTaskOutcome = 'completed' | 'failed' | 'blocked';

export interface TermixTaskAttempt {
  outcome: TermixTaskOutcome;
  durationMs: number;
  costMicrousd: number;
  qualityBps: number;
  evidenceRefs: readonly string[];
}

export interface TermixTaskPair {
  id: string;
  task: string;
  withoutAgent: TermixTaskAttempt;
  withAgent: TermixTaskAttempt;
}

export interface TermixTaskComparison {
  id: string;
  task: string;
  completionDelta: -1 | 0 | 1;
  qualityDeltaBps: number;
  latencyImprovementBps: number;
  costImprovementBps: number;
}

export interface TermixAdvantageReport {
  version: typeof TERMIX_INTEGRATION_VERSION;
  agentId: string;
  generatedAt: number;
  taskCount: number;
  comparisons: readonly TermixTaskComparison[];
  aggregate: {
    completedWithoutAgent: number;
    completedWithAgent: number;
    completionDelta: number;
    averageQualityDeltaBps: number;
    averageLatencyImprovementBps: number;
    averageCostImprovementBps: number;
  };
}

export interface TermixNetworkConfig {
  chainId: number;
  contracts: Readonly<Record<string, `0x${string}`>>;
  observedAt: number;
}

export interface TermixProtocolStats {
  metrics: Readonly<Record<string, number>>;
  observedAt: number;
}

export type TermixErrorCode =
  'invalid-report' | 'invalid-config' | 'network-unavailable' | 'http-error' | 'invalid-response';

export class TermixIntegrationError extends Error {
  constructor(
    readonly code: TermixErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TermixIntegrationError';
  }
}

export function createTermixAdvantageReport(input: unknown): TermixAdvantageReport {
  if (!isRecord(input) || !isNonEmptyString(input.agentId) || !isUnixSeconds(input.generatedAt)) {
    throw new TermixIntegrationError('invalid-report', 'agentId and generatedAt are required');
  }
  if (!Array.isArray(input.cases) || input.cases.length < 3) {
    throw new TermixIntegrationError('invalid-report', 'at least three task pairs are required');
  }

  const ids = new Set<string>();
  const comparisons = input.cases.map((candidate) => {
    const pair = validateTaskPair(candidate);
    if (ids.has(pair.id)) {
      throw new TermixIntegrationError('invalid-report', `duplicate task case: ${pair.id}`);
    }
    ids.add(pair.id);
    return compareTaskPair(pair);
  });
  const completedWithoutAgent = input.cases.filter(
    (candidate) => validateTaskPair(candidate).withoutAgent.outcome === 'completed',
  ).length;
  const completedWithAgent = input.cases.filter(
    (candidate) => validateTaskPair(candidate).withAgent.outcome === 'completed',
  ).length;

  return Object.freeze({
    version: TERMIX_INTEGRATION_VERSION,
    agentId: input.agentId,
    generatedAt: input.generatedAt,
    taskCount: comparisons.length,
    comparisons,
    aggregate: {
      completedWithoutAgent,
      completedWithAgent,
      completionDelta: completedWithAgent - completedWithoutAgent,
      averageQualityDeltaBps: average(comparisons.map((item) => item.qualityDeltaBps)),
      averageLatencyImprovementBps: average(comparisons.map((item) => item.latencyImprovementBps)),
      averageCostImprovementBps: average(comparisons.map((item) => item.costImprovementBps)),
    },
  });
}

export class TermixPublicClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.#baseUrl = validateBaseUrl(options.baseUrl ?? TERMIX_PUBLIC_API_URL);
    this.#fetch = options.fetch ?? fetch;
  }

  async getConfig(observedAt: number): Promise<TermixNetworkConfig> {
    const data = await this.#get('config');
    const root = unwrapData(data);
    if (root.chainId !== 97 || !isRecord(root.contracts)) {
      throw new TermixIntegrationError('invalid-response', 'TermiX config shape is invalid');
    }
    const contracts: Record<string, `0x${string}`> = {};
    for (const [name, value] of Object.entries(root.contracts)) {
      if (!isAddress(value)) {
        throw new TermixIntegrationError('invalid-response', `invalid contract address: ${name}`);
      }
      contracts[name] = value;
    }
    if (Object.keys(contracts).length === 0 || !isUnixSeconds(observedAt)) {
      throw new TermixIntegrationError('invalid-response', 'TermiX config evidence is incomplete');
    }
    return { chainId: root.chainId, contracts, observedAt };
  }

  async getStats(observedAt: number): Promise<TermixProtocolStats> {
    const root = unwrapData(await this.#get('stats'));
    if (!isUnixSeconds(observedAt)) {
      throw new TermixIntegrationError('invalid-response', 'observedAt must be Unix seconds');
    }
    const metrics: Record<string, number> = {};
    collectMetrics(root, '', metrics);
    if (Object.keys(metrics).length === 0) {
      throw new TermixIntegrationError(
        'invalid-response',
        'TermiX stats contain no numeric metrics',
      );
    }
    return { metrics, observedAt };
  }

  async #get(path: 'config' | 'stats'): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/${path}`, {
        headers: { accept: 'application/json' },
      });
    } catch {
      throw new TermixIntegrationError('network-unavailable', 'TermiX public API is unavailable');
    }
    if (!response.ok) {
      throw new TermixIntegrationError(
        'http-error',
        `TermiX public API returned ${response.status}`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new TermixIntegrationError('invalid-response', 'TermiX response is not valid JSON');
    }
  }
}

function validateTaskPair(value: unknown): TermixTaskPair {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.task)) {
    throw new TermixIntegrationError('invalid-report', 'task case id and task are required');
  }
  return {
    id: value.id,
    task: value.task,
    withoutAgent: validateAttempt(value.withoutAgent),
    withAgent: validateAttempt(value.withAgent),
  };
}

function validateAttempt(value: unknown): TermixTaskAttempt {
  if (!isRecord(value) || !['completed', 'failed', 'blocked'].includes(String(value.outcome))) {
    throw new TermixIntegrationError('invalid-report', 'task outcome is invalid');
  }
  if (!isMetric(value.durationMs) || !isMetric(value.costMicrousd) || !isBps(value.qualityBps)) {
    throw new TermixIntegrationError('invalid-report', 'task metrics are invalid');
  }
  if (
    !Array.isArray(value.evidenceRefs) ||
    value.evidenceRefs.length === 0 ||
    !value.evidenceRefs.every(isNonEmptyString)
  ) {
    throw new TermixIntegrationError('invalid-report', 'task evidence references are required');
  }
  return value as unknown as TermixTaskAttempt;
}

function compareTaskPair(pair: TermixTaskPair): TermixTaskComparison {
  const completion = (attempt: TermixTaskAttempt) => (attempt.outcome === 'completed' ? 1 : 0);
  return {
    id: pair.id,
    task: pair.task,
    completionDelta: (completion(pair.withAgent) - completion(pair.withoutAgent)) as -1 | 0 | 1,
    qualityDeltaBps: pair.withAgent.qualityBps - pair.withoutAgent.qualityBps,
    latencyImprovementBps: improvement(pair.withoutAgent.durationMs, pair.withAgent.durationMs),
    costImprovementBps: improvement(pair.withoutAgent.costMicrousd, pair.withAgent.costMicrousd),
  };
}

function improvement(baseline: number, agent: number): number {
  return baseline === 0 ? 0 : Math.trunc(((baseline - agent) * 10_000) / baseline);
}

function average(values: readonly number[]): number {
  return Math.trunc(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function validateBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error();
    return url.toString().replace(/\/$/u, '');
  } catch {
    throw new TermixIntegrationError(
      'invalid-config',
      'TermiX base URL must be credential-free HTTPS',
    );
  }
}

function unwrapData(value: unknown): Record<string, unknown> {
  if (!isRecord(value))
    throw new TermixIntegrationError('invalid-response', 'response must be an object');
  return isRecord(value.data) ? value.data : value;
}

function collectMetrics(value: unknown, prefix: string, output: Record<string, number>): void {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isMetric(child)) output[path] = child;
    else if (isRecord(child)) collectMetrics(child, path, output);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isUnixSeconds(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function isMetric(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 900_000_000_000
  );
}
function isBps(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000;
}
function isAddress(value: unknown): value is `0x${string}` {
  return (
    typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/u.test(value) && !/^0x0{40}$/u.test(value)
  );
}
