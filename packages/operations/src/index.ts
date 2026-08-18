export const PRODUCTION_VERIFICATION_VERSION = 'm17.v1' as const;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_TEXT_BYTES = 256 * 1024;

export type VerificationCheckStatus = 'passed' | 'failed';

export interface VerificationCheck {
  name: string;
  status: VerificationCheckStatus;
  statusCode: number | null;
  durationMs: number;
  message: string;
}

export interface ProductionVerificationReport {
  version: typeof PRODUCTION_VERIFICATION_VERSION;
  startedAt: string;
  completedAt: string;
  apiUrl: string;
  webUrl: string;
  expectedReleaseId: string;
  passed: boolean;
  agentRegistry: string | null;
  checks: readonly VerificationCheck[];
}

export interface ProductionVerificationOptions {
  apiUrl: string;
  webUrl: string;
  expectedReleaseId: string;
  fetchImpl?: ProductionFetch;
  now?: () => string;
  timeoutMs?: number;
}

export type ProductionFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface JsonRequestResult {
  statusCode: number | null;
  body: unknown;
  response: Response | null;
  failed: boolean;
  durationMs: number;
}

interface WebRequestResult {
  statusCode: number | null;
  response: Response | null;
  failed: boolean;
  durationMs: number;
}

export class ProductionVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionVerificationError';
  }
}

export async function runProductionVerification(
  options: ProductionVerificationOptions,
): Promise<ProductionVerificationReport> {
  const apiUrl = normalizeHttpsOrigin(options.apiUrl, 'apiUrl');
  const webUrl = normalizeHttpsOrigin(options.webUrl, 'webUrl');
  const expectedReleaseId = normalizeReleaseId(options.expectedReleaseId);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new ProductionVerificationError('timeoutMs must be a positive safe integer');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const checks: VerificationCheck[] = [];

  const health = await requestJson(fetchImpl, `${apiUrl}/health`, timeoutMs);
  checks.push(
    checkJson('api-health', health, (body) =>
      health.statusCode === 200 && isStatusPayload(body) && body.status === 'ok'
        ? null
        : 'API liveness did not return the expected healthy response',
    ),
  );
  checks.push(checkSecurityHeaders(health));

  const ready = await requestJson(fetchImpl, `${apiUrl}/ready`, timeoutMs);
  checks.push(
    checkJson('api-readiness', ready, (body) =>
      ready.statusCode === 200 && isStatusPayload(body) && body.status === 'ok'
        ? null
        : 'API repository readiness did not succeed',
    ),
  );

  const release = await requestJson(fetchImpl, `${apiUrl}/version`, timeoutMs);
  checks.push(
    checkJson('release-identity', release, (body) => {
      if (release.statusCode !== 200 || !isRecord(body) || body.status !== 'ok') {
        return 'API release identity did not return a healthy response';
      }
      return body.releaseId === expectedReleaseId
        ? null
        : 'API release identity does not match the reviewed release';
    }),
  );

  const discovery = await requestJson(fetchImpl, `${apiUrl}/agents?limit=1`, timeoutMs);
  const discoveredRegistry = firstAgentRegistry(discovery.body);
  checks.push(
    checkJson('agent-discovery', discovery, (body) => {
      if (discovery.statusCode !== 200 || !isPaginatedPayload(body)) {
        return 'agent discovery did not return a valid paginated response';
      }
      return discoveredRegistry ? null : 'agent discovery returned no real indexed agents';
    }),
  );

  let agentRegistry: string | null = discoveredRegistry;
  if (agentRegistry) {
    const profile = await requestJson(
      fetchImpl,
      `${apiUrl}/agents/${encodeURIComponent(agentRegistry)}`,
      timeoutMs,
    );
    checks.push(
      checkJson('agent-profile', profile, (body) => {
        if (profile.statusCode !== 200 || !isRecord(body) || !isRecord(body.agent)) {
          return 'agent profile did not return a valid response';
        }
        return body.agent.agentRegistry === agentRegistry
          ? null
          : 'agent profile registry does not match discovery';
      }),
    );

    const history = await requestJson(
      fetchImpl,
      `${apiUrl}/agents/${encodeURIComponent(agentRegistry)}/executions`,
      timeoutMs,
    );
    checks.push(
      checkJson('execution-history', history, (body) =>
        history.statusCode === 200 && isPaginatedPayload(body)
          ? null
          : 'execution history did not return a valid public response',
      ),
    );
  } else {
    agentRegistry = null;
    checks.push(failedCheck('agent-profile', 'skipped because discovery provided no agent'));
    checks.push(failedCheck('execution-history', 'skipped because discovery provided no agent'));
  }

  const web = await requestWeb(fetchImpl, `${webUrl}/`, timeoutMs);
  checks.push(
    checkWeb('web-root', web, (response) => {
      const contentType = response?.headers.get('content-type')?.toLowerCase() ?? '';
      return web.statusCode === 200 && contentType.includes('text/html')
        ? null
        : 'web root did not return an HTML success response';
    }),
  );

  const completedAt = now();
  return {
    version: PRODUCTION_VERIFICATION_VERSION,
    startedAt,
    completedAt,
    apiUrl,
    webUrl,
    expectedReleaseId,
    passed: checks.every((check) => check.status === 'passed'),
    agentRegistry,
    checks,
  };
}

function normalizeHttpsOrigin(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProductionVerificationError(`${field} must be a valid HTTPS origin`);
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ProductionVerificationError(`${field} must be a valid HTTPS origin`);
  }
  return parsed.origin;
}

function normalizeReleaseId(value: string): string {
  if (value.length < 7 || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u.test(value)) {
    throw new ProductionVerificationError('expectedReleaseId is malformed');
  }
  return value;
}

async function requestJson(
  fetchImpl: ProductionFetch,
  url: string,
  timeoutMs: number,
): Promise<JsonRequestResult> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    try {
      const text = await readBoundedText(response);
      return {
        statusCode: response.status,
        body: JSON.parse(text) as unknown,
        response,
        failed: false,
        durationMs: Date.now() - startedAt,
      };
    } catch {
      return {
        statusCode: response.status,
        body: null,
        response,
        failed: true,
        durationMs: Date.now() - startedAt,
      };
    }
  } catch {
    return {
      statusCode: null,
      body: null,
      response: null,
      failed: true,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function requestWeb(
  fetchImpl: ProductionFetch,
  url: string,
  timeoutMs: number,
): Promise<WebRequestResult> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      statusCode: response.status,
      response,
      failed: false,
      durationMs: Date.now() - startedAt,
    };
  } catch {
    return {
      statusCode: null,
      response: null,
      failed: true,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_RESPONSE_TEXT_BYTES) {
    throw new Error('response body exceeds verifier limit');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_TEXT_BYTES) {
    throw new Error('response body exceeds verifier limit');
  }
  return text;
}

function checkJson(
  name: string,
  result: JsonRequestResult,
  validate: (body: unknown) => string | null,
): VerificationCheck {
  if (result.failed) return failedCheck(name, 'request failed or returned malformed JSON', result);
  const message = validate(result.body);
  return message === null
    ? passedCheck(name, result.statusCode, result.durationMs)
    : failedCheck(name, message, result);
}

function checkSecurityHeaders(result: JsonRequestResult): VerificationCheck {
  if (result.failed || !result.response) {
    return failedCheck('security-headers', 'API health response was unavailable', result);
  }
  const requiredHeaders: ReadonlyArray<[string, string]> = [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'SAMEORIGIN'],
    ['referrer-policy', 'no-referrer'],
  ];
  const missing = requiredHeaders.find(
    ([name, expected]) => result.response?.headers.get(name) !== expected,
  );
  const requestId = result.response.headers.get('x-request-id');
  if (missing)
    return failedCheck('security-headers', `${missing[0]} header is missing or invalid`, result);
  if (!requestId || requestId.length > 128) {
    return failedCheck(
      'security-headers',
      'generated x-request-id header is missing or invalid',
      result,
    );
  }
  return passedCheck('security-headers', result.statusCode, result.durationMs);
}

function checkWeb(
  name: string,
  result: WebRequestResult,
  validate: (response: Response | null) => string | null,
): VerificationCheck {
  if (result.failed) return failedCheck(name, 'web request failed', result);
  const message = validate(result.response);
  return message === null
    ? passedCheck(name, result.statusCode, result.durationMs)
    : failedCheck(name, message, result);
}

function passedCheck(
  name: string,
  statusCode: number | null,
  durationMs: number,
): VerificationCheck {
  return { name, status: 'passed', statusCode, durationMs, message: 'ok' };
}

function failedCheck(
  name: string,
  message: string,
  result?: { statusCode: number | null; durationMs: number },
): VerificationCheck {
  return {
    name,
    status: 'failed',
    statusCode: result?.statusCode ?? null,
    durationMs: result?.durationMs ?? 0,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStatusPayload(value: unknown): value is { status: string } {
  return isRecord(value) && typeof value.status === 'string';
}

function isPaginatedPayload(value: unknown): value is { items: unknown[]; nextCursor: unknown } {
  return isRecord(value) && Array.isArray(value.items) && 'nextCursor' in value;
}

function isAgentRegistry(value: string): boolean {
  return value.length <= 512 && /^eip155:\d+:[^:]+:\d+$/u.test(value);
}

function firstAgentRegistry(value: unknown): string | null {
  if (!isPaginatedPayload(value)) return null;
  const first = value.items[0];
  if (!isRecord(first) || typeof first.agentRegistry !== 'string') return null;
  return isAgentRegistry(first.agentRegistry) ? first.agentRegistry : null;
}
