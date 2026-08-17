import { describe, expect, it, vi } from 'vitest';
import {
  TERMIX_PUBLIC_API_URL,
  TermixIntegrationError,
  TermixPublicClient,
  createTermixAdvantageReport,
} from '../src/index.js';

const attempt = (overrides: Record<string, unknown> = {}) => ({
  outcome: 'completed',
  durationMs: 1000,
  costMicrousd: 100,
  qualityBps: 7000,
  evidenceRefs: ['trace:case'],
  ...overrides,
});

const cases = Array.from({ length: 3 }, (_, index) => ({
  id: `case-${index + 1}`,
  task: `Task ${index + 1}`,
  withoutAgent: attempt({ outcome: 'failed', durationMs: 2000, costMicrousd: 200 }),
  withAgent: attempt({ durationMs: 1000, costMicrousd: 100, qualityBps: 8000 }),
}));

describe('TermiX integration (M13)', () => {
  it('builds deterministic advantage evidence from three task pairs', () => {
    const report = createTermixAdvantageReport({
      agentId: '42',
      generatedAt: 1_800_000_000,
      cases,
    });

    expect(report.taskCount).toBe(3);
    expect(report.aggregate.completedWithoutAgent).toBe(0);
    expect(report.aggregate.completedWithAgent).toBe(3);
    expect(report.aggregate.completionDelta).toBe(3);
    expect(report.aggregate.averageQualityDeltaBps).toBe(1000);
    expect(report.aggregate.averageLatencyImprovementBps).toBe(5000);
    expect(report.aggregate.averageCostImprovementBps).toBe(5000);
  });

  it('rejects fewer than three cases, duplicates, and missing evidence', () => {
    expect(() =>
      createTermixAdvantageReport({ agentId: '42', generatedAt: 1, cases: cases.slice(0, 2) }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-report' }));
    expect(() =>
      createTermixAdvantageReport({
        agentId: '42',
        generatedAt: 1,
        cases: [cases[0], cases[0], cases[2]],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-report' }));
    expect(() =>
      createTermixAdvantageReport({
        agentId: '42',
        generatedAt: 1,
        cases: cases.map((item) => ({
          ...item,
          withAgent: { ...item.withAgent, evidenceRefs: [] },
        })),
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-report' }));
  });

  it('reads and validates documented public config and stats shapes', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const body = url.endsWith('/config')
        ? {
            data: {
              chainId: 97,
              contracts: { jobManager: '0x1111111111111111111111111111111111111111' },
            },
          }
        : { data: { totalJobs: 3, completedJobs: 2, nested: { activeAgents: 1 } } };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const client = new TermixPublicClient({
      baseUrl: TERMIX_PUBLIC_API_URL,
      fetch: fetchMock as typeof fetch,
    });

    await expect(client.getConfig(1_800_000_000)).resolves.toMatchObject({ chainId: 97 });
    await expect(client.getStats(1_800_000_000)).resolves.toMatchObject({
      metrics: { totalJobs: 3, completedJobs: 2, 'nested.activeAgents': 1 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed for unavailable, non-testnet, and malformed responses', async () => {
    const unavailable = new TermixPublicClient({
      fetch: vi.fn(async () => {
        throw new Error('offline');
      }) as typeof fetch,
    });
    await expect(unavailable.getConfig(1)).rejects.toBeInstanceOf(TermixIntegrationError);

    const bad = new TermixPublicClient({
      fetch: vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { chainId: 56, contracts: {} } }), { status: 200 }),
      ) as typeof fetch,
    });
    await expect(bad.getConfig(1)).rejects.toMatchObject({ code: 'invalid-response' });
  });
});
