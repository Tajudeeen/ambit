import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/agents/[agentRegistry]/hire/route';
import { CATEGORY_DIRECTORY, categoryHref } from '../lib/categories';
import { formatAddress, formatLabel } from '../lib/format';
import { getAgent, searchAgents } from '../lib/marketplace-api';
import { hasFilters, nextPageHref, searchInput } from '../lib/search';

const AGENT_REGISTRY = 'eip155:56:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:7';

describe('M10 marketplace web contracts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NEXT_PUBLIC_API_URL = 'http://api.test';
  });

  it('normalizes URL search state without adding default visibility gates', () => {
    const values = searchInput({
      q: ['venus', 'ignored'],
      category: 'health-factor',
      verificationTier: undefined,
      supportedExecution: 'true',
      minTrustScore: '80',
    });

    expect(values).toEqual({
      q: 'venus',
      category: 'health-factor',
      verificationTier: undefined,
      supportedExecution: 'true',
      protocol: undefined,
      minTrustScore: '80',
      cursor: undefined,
    });
    expect(hasFilters(values)).toBe(true);
    expect(nextPageHref(values, 'next_cursor')).toBe(
      '/?q=venus&category=health-factor&supportedExecution=true&minTrustScore=80&cursor=next_cursor',
    );
  });

  it('exposes every M11 category as an explicit marketplace filter', () => {
    expect(CATEGORY_DIRECTORY.map((category) => category.id)).toEqual([
      'monitoring',
      'grid-trading',
      'health-factor',
      'yield',
    ]);
    expect(new Set(CATEGORY_DIRECTORY.map((category) => category.code)).size).toBe(4);
    expect(CATEGORY_DIRECTORY.every((category) => category.description.length > 30)).toBe(true);
    expect(categoryHref('health-factor')).toBe('/?category=health-factor#marketplace');
  });

  it('builds live API searches with explicit query parameters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await searchAgents({ q: 'venus', verificationTier: 'data-verified', limit: '12' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/agents?q=venus&verificationTier=data-verified&limit=12',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('preserves structured API failures and treats missing profiles as not found', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: 'invalid-request',
                message: 'filters are invalid',
                issues: ['category is invalid'],
              },
            }),
            { status: 400 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: { code: 'not-found' } }), { status: 404 }),
        ),
    );

    await expect(searchAgents({ category: 'not-real' })).rejects.toMatchObject({
      status: 400,
      code: 'invalid-request',
      issues: ['category is invalid'],
    });
    await expect(getAgent(AGENT_REGISTRY)).resolves.toBeNull();
  });

  it('forwards only public pending-hire fields through the same-origin proxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          request: { id: 'request_1', requestStatus: 'pending-authorization' },
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('http://web.test/api/agents/hire', {
      method: 'POST',
      body: JSON.stringify({
        clientRequestId: 'client-1',
        requester: '0x2222222222222222222222222222222222222222',
        destination: '0x3333333333333333333333333333333333333333',
        protocol: 'venus',
        requestedValue: '0',
        sessionId: 'must-not-forward',
        calldata: '0xdeadbeef',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request, {
      params: Promise.resolve({ agentRegistry: AGENT_REGISTRY }),
    });

    expect(response.status).toBe(202);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify({
        clientRequestId: 'client-1',
        requester: '0x2222222222222222222222222222222222222222',
        destination: '0x3333333333333333333333333333333333333333',
        protocol: 'venus',
        requestedValue: '0',
      }),
    );
    expect(init.body).not.toContain('sessionId');
    expect(init.body).not.toContain('calldata');
  });

  it('returns a generic unavailable response when the upstream cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const response = await POST(
      new Request('http://web.test/api/agents/hire', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ agentRegistry: AGENT_REGISTRY }) },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: 'repository-unavailable',
        message: 'The marketplace is unavailable. No hire request was created.',
      },
    });
  });

  it('keeps evidence labels readable without exposing full wallet addresses by default', () => {
    expect(formatLabel('execution-verified')).toBe('Execution Verified');
    expect(formatAddress('0x2222222222222222222222222222222222222222')).toBe('0x22222222…222222');
  });
});
