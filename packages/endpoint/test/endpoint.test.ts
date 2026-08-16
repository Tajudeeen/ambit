import { describe, it, expect } from 'vitest';
import { isBlockedAddress, probeEndpoint } from '../src/index.js';

describe('SSRF protection', () => {
  it('blocks private/loopback/link-local ranges', () => {
    expect(isBlockedAddress('10.0.0.5')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true); // cloud metadata
    expect(isBlockedAddress('::1')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('104.18.32.7')).toBe(false);
  });

  it('blocks non-http(s) schemes', async () => {
    const r = await probeEndpoint('file:///etc/passwd');
    expect(r.status).toBe('blocked');
  });

  it('returns blocked (not down) for internal hosts without network call', async () => {
    const r = await probeEndpoint('http://169.254.169.254/latest/meta-data');
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/blocked/);
  });
});

describe('endpoint probing (injected fetch)', () => {
  it('reports up for a 200', async () => {
    const fakeFetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const r = await probeEndpoint('https://example.com/health', fakeFetch);
    expect(r.status).toBe('up');
    expect(r.httpStatus).toBe(200);
    expect(typeof r.latencyMs).toBe('number');
  });

  it('reports down on network error', async () => {
    const fakeFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const r = await probeEndpoint('https://example.com/down', fakeFetch);
    expect(r.status).toBe('down');
  });
});
