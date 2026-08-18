import { describe, expect, it, vi } from 'vitest';
import { DemoConfigurationError, runDemoRehearsal, type DemoFetch } from '../src/index.js';

const agentRegistry = 'eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:7';

function fakeFetch(routes: Record<string, Response>): DemoFetch {
  return vi.fn(async (url: string) => {
    const response = routes[url];
    if (!response) throw new Error('unexpected URL');
    return response;
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('M16 demo rehearsal', () => {
  it('passes only with live-shaped health, discovery, profile, history, and web responses', async () => {
    const report = await runDemoRehearsal({
      apiUrl: 'https://api.example/',
      webUrl: 'https://app.example/',
      now: vi.fn(() => '2026-08-18T12:00:00.000Z'),
      fetchImpl: fakeFetch({
        'https://api.example/health': json({ status: 'ok', service: 'ambit-api' }),
        'https://api.example/ready': json({ status: 'ok', service: 'ambit-api' }),
        'https://api.example/agents?limit=1': json({
          items: [{ agentRegistry }],
          nextCursor: null,
        }),
        [`https://api.example/agents/${encodeURIComponent(agentRegistry)}`]: json({
          agent: { agentRegistry },
        }),
        [`https://api.example/agents/${encodeURIComponent(agentRegistry)}/executions`]: json({
          items: [],
          nextCursor: null,
        }),
        'https://app.example/': new Response('<html><body>Ambit</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      }),
    });

    expect(report.passed).toBe(true);
    expect(report.agentRegistry).toBe(agentRegistry);
    expect(report.checks.every((check) => check.status === 'passed')).toBe(true);
  });

  it('fails closed when discovery is empty and never invents profile evidence', async () => {
    const fetchImpl = fakeFetch({
      'http://api.test/health': json({ status: 'ok' }),
      'http://api.test/ready': json({ status: 'ok' }),
      'http://api.test/agents?limit=1': json({ items: [], nextCursor: null }),
      'http://web.test/': new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    });

    const report = await runDemoRehearsal({
      apiUrl: 'http://api.test',
      webUrl: 'http://web.test',
      fetchImpl,
    });

    expect(report.passed).toBe(false);
    expect(report.agentRegistry).toBeNull();
    expect(report.checks.find((check) => check.name === 'agent-discovery')?.message).toContain(
      'no real indexed agents',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('fails closed on inconsistent profile identity and rejects unsafe origins', async () => {
    const report = await runDemoRehearsal({
      apiUrl: 'http://api.test',
      webUrl: 'http://web.test',
      fetchImpl: fakeFetch({
        'http://api.test/health': json({ status: 'ok' }),
        'http://api.test/ready': json({ status: 'ok' }),
        'http://api.test/agents?limit=1': json({
          items: [{ agentRegistry }],
          nextCursor: null,
        }),
        [`http://api.test/agents/${encodeURIComponent(agentRegistry)}`]: json({
          agent: { agentRegistry: `${agentRegistry}-different` },
        }),
        [`http://api.test/agents/${encodeURIComponent(agentRegistry)}/executions`]: json({
          items: [],
          nextCursor: null,
        }),
        'http://web.test/': new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      }),
    });

    expect(report.passed).toBe(false);
    expect(report.checks.find((check) => check.name === 'agent-profile')?.message).toContain(
      'does not match discovery',
    );
    await expect(
      runDemoRehearsal({ apiUrl: 'file:///tmp/api', webUrl: 'https://web.test' }),
    ).rejects.toBeInstanceOf(DemoConfigurationError);
  });
});
