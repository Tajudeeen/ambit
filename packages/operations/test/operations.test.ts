import { describe, expect, it, vi } from 'vitest';
import {
  ProductionVerificationError,
  runProductionVerification,
  type ProductionFetch,
} from '../src/index.js';

const agentRegistry = 'eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:7';
const releaseId = 'abcdef1234567890';

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function web(): Response {
  return new Response('<html><body>Ambit</body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function fakeFetch(routes: Record<string, Response>): ProductionFetch {
  return vi.fn(async (input: string) => {
    const response = routes[input];
    if (!response) throw new Error(`unexpected URL ${input}`);
    return response;
  });
}

function passingRoutes(healthHeaders: Record<string, string> = {}): Record<string, Response> {
  const api = 'https://api.example';
  const app = 'https://app.example';
  return {
    [`${api}/health`]: json({ status: 'ok', service: 'ambit-api' }, 200, {
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'no-referrer',
      'x-request-id': 'generated-request-id',
      ...healthHeaders,
    }),
    [`${api}/ready`]: json({ status: 'ok', service: 'ambit-api' }),
    [`${api}/version`]: json({ status: 'ok', service: 'ambit-api', releaseId }),
    [`${api}/agents?limit=1`]: json({ items: [{ agentRegistry }], nextCursor: null }),
    [`${api}/agents/${encodeURIComponent(agentRegistry)}`]: json({ agent: { agentRegistry } }),
    [`${api}/agents/${encodeURIComponent(agentRegistry)}/executions`]: json({
      items: [],
      nextCursor: null,
    }),
    [`${app}/`]: web(),
  };
}

describe('M17 production verification', () => {
  it('passes only with matching live release, evidence, headers, and web output', async () => {
    const report = await runProductionVerification({
      apiUrl: 'https://api.example/',
      webUrl: 'https://app.example/',
      expectedReleaseId: releaseId,
      now: vi.fn(() => '2026-08-18T12:00:00.000Z'),
      fetchImpl: fakeFetch(passingRoutes()),
    });

    expect(report.passed).toBe(true);
    expect(report.version).toBe('m17.v1');
    expect(report.agentRegistry).toBe(agentRegistry);
    expect(report.checks.every((check) => check.status === 'passed')).toBe(true);
  });

  it('fails closed on release mismatch and missing security headers', async () => {
    const report = await runProductionVerification({
      apiUrl: 'https://api.example',
      webUrl: 'https://app.example',
      expectedReleaseId: 'different-release',
      fetchImpl: fakeFetch(passingRoutes({ 'x-frame-options': 'DENY' })),
    });

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === 'release-identity')?.message).toContain(
      'does not match',
    );
    expect(report.checks.find((check) => check.name === 'security-headers')?.status).toBe('failed');
  });

  it('fails closed on empty discovery without requesting invented profile evidence', async () => {
    const routes = passingRoutes();
    routes['https://api.example/agents?limit=1'] = json({ items: [], nextCursor: null });
    const fetchImpl = fakeFetch(routes);
    const report = await runProductionVerification({
      apiUrl: 'https://api.example',
      webUrl: 'https://app.example',
      expectedReleaseId: releaseId,
      fetchImpl,
    });

    expect(report.passed).toBe(false);
    expect(report.agentRegistry).toBeNull();
    expect(report.checks.find((check) => check.name === 'agent-discovery')?.message).toContain(
      'no real indexed agents',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('rejects non-HTTPS origins and malformed expected identities before requests', async () => {
    await expect(
      runProductionVerification({
        apiUrl: 'http://api.example',
        webUrl: 'https://app.example',
        expectedReleaseId: releaseId,
      }),
    ).rejects.toBeInstanceOf(ProductionVerificationError);
    await expect(
      runProductionVerification({
        apiUrl: 'https://api.example',
        webUrl: 'https://app.example/path',
        expectedReleaseId: 'bad id',
      }),
    ).rejects.toBeInstanceOf(ProductionVerificationError);
  });
});
