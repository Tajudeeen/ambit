export const DEMO_REHEARSAL_VERSION = 'm16.v1';

export type DemoCheckStatus = 'passed' | 'failed';

export interface DemoCheck {
  name: string;
  status: DemoCheckStatus;
  statusCode: number | null;
  durationMs: number;
  message: string;
}

export interface DemoRehearsalReport {
  version: typeof DEMO_REHEARSAL_VERSION;
  startedAt: string;
  completedAt: string;
  passed: boolean;
  agentRegistry: string | null;
  checks: readonly DemoCheck[];
}

export interface DemoRehearsalOptions {
  apiUrl: string;
  webUrl: string;
  fetchImpl?: DemoFetch;
  now?: () => string;
}

export type DemoFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface JsonRequestResult {
  statusCode: number | null;
  body: unknown;
  response: Response | null;
  failed: boolean;
  durationMs: number;
}

export class DemoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoConfigurationError';
  }
}

export async function runDemoRehearsal(
  options: DemoRehearsalOptions,
): Promise<DemoRehearsalReport> {
  const apiUrl = normalizeBaseUrl(options.apiUrl, 'apiUrl');
  const webUrl = normalizeBaseUrl(options.webUrl, 'webUrl');
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const checks: DemoCheck[] = [];

  const health = await requestJson(fetchImpl, `${apiUrl}/health`);
  checks.push(
    checkJson('api-health', health, (body) =>
      health.statusCode === 200 && isStatusPayload(body) && body.status === 'ok'
        ? null
        : 'API liveness did not return the expected healthy response',
    ),
  );

  const ready = await requestJson(fetchImpl, `${apiUrl}/ready`);
  checks.push(
    checkJson('api-readiness', ready, (body) =>
      ready.statusCode === 200 && isStatusPayload(body) && body.status === 'ok'
        ? null
        : 'API repository readiness did not succeed',
    ),
  );

  const discovery = await requestJson(fetchImpl, `${apiUrl}/agents?limit=1`);
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

  const web = await requestWeb(fetchImpl, `${webUrl}/`);
  checks.push(
    webCheck('web-root', web, (response) => {
      const contentType = response?.headers.get('content-type')?.toLowerCase() ?? '';
      return web.statusCode === 200 && contentType.includes('text/html')
        ? null
        : 'web root did not return an HTML success response';
    }),
  );

  const completedAt = now();
  return {
    version: DEMO_REHEARSAL_VERSION,
    startedAt,
    completedAt,
    passed: checks.every((check) => check.status === 'passed'),
    agentRegistry,
    checks,
  };
}

async function requestJson(fetchImpl: DemoFetch, url: string): Promise<JsonRequestResult> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
    });
    try {
      return {
        statusCode: response.status,
        body: await response.json(),
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

async function requestWeb(fetchImpl: DemoFetch, url: string): Promise<JsonRequestResult> {
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url);
    await response.text();
    return {
      statusCode: response.status,
      body: null,
      response,
      failed: false,
      durationMs: Date.now() - startedAt,
    };
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

function checkJson(
  name: string,
  result: JsonRequestResult,
  validate: (body: unknown) => string | null,
): DemoCheck {
  const message = result.failed ? 'request or JSON response failed' : validate(result.body);
  return {
    name,
    status: message ? 'failed' : 'passed',
    statusCode: result.statusCode,
    durationMs: result.durationMs,
    message: message ?? 'ok',
  };
}

function webCheck(
  name: string,
  result: JsonRequestResult,
  validate: (response: Response | null) => string | null,
): DemoCheck {
  const message = result.failed ? 'request or HTML response failed' : validate(result.response);
  return {
    name,
    status: message ? 'failed' : 'passed',
    statusCode: result.statusCode,
    durationMs: result.durationMs,
    message: message ?? 'ok',
  };
}

function failedCheck(name: string, message: string): DemoCheck {
  return { name, status: 'failed', statusCode: null, durationMs: 0, message };
}

function normalizeBaseUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DemoConfigurationError(`${name} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new DemoConfigurationError(`${name} must be an absolute HTTP(S) URL without credentials`);
  }
  if (parsed.search || parsed.hash) {
    throw new DemoConfigurationError(`${name} must not include a query or fragment`);
  }
  return parsed.toString().replace(/\/+$/u, '');
}

function firstAgentRegistry(value: unknown): string | null {
  if (!isPaginatedPayload(value) || value.items.length === 0) return null;
  const first = value.items[0];
  return isRecord(first) && typeof first.agentRegistry === 'string' && first.agentRegistry
    ? first.agentRegistry
    : null;
}

function isStatusPayload(value: unknown): value is { status: string } {
  return isRecord(value) && typeof value.status === 'string';
}

function isPaginatedPayload(value: unknown): value is { items: unknown[]; nextCursor: unknown } {
  return isRecord(value) && Array.isArray(value.items) && 'nextCursor' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
