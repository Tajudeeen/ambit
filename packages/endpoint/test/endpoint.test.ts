import { describe, expect, it, vi } from 'vitest';
import {
  isBlockedAddress,
  probeEndpoint,
  type EndpointResolver,
  type PinnedProbeRequest,
} from '../src/index.js';

const publicResolver: EndpointResolver = async () => [
  { address: '93.184.216.34', family: 4 },
];

describe('SSRF address policy', () => {
  it('blocks private, loopback, link-local, reserved, and mapped ranges', () => {
    expect(isBlockedAddress('0.0.0.1')).toBe(true);
    expect(isBlockedAddress('10.0.0.5')).toBe(true);
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
    expect(isBlockedAddress('198.51.100.1')).toBe(true);
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('fd00::1')).toBe(true);
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('allows public IPv4 and IPv6 addresses', () => {
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('104.18.32.7')).toBe(false);
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('blocks non-http schemes and URL credentials', async () => {
    expect((await probeEndpoint('file:///etc/passwd')).status).toBe('blocked');
    expect((await probeEndpoint('https://user:secret@example.com')).status).toBe('blocked');
  });

  it('blocks literal internal hosts without starting a request', async () => {
    const transport = vi.fn();
    const result = await probeEndpoint('http://169.254.169.254/latest/meta-data', {
      transport,
    });

    expect(result.status).toBe('blocked');
    expect(result.reason).toMatch(/blocked/);
    expect(transport).not.toHaveBeenCalled();
  });

  it('fails closed when any resolved address is blocked', async () => {
    const transport = vi.fn();
    const result = await probeEndpoint('https://example.com/health', {
      resolver: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      transport,
    });

    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('127.0.0.1');
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('connection-pinned endpoint probing', () => {
  it('passes the approved address and original TLS identity to the transport', async () => {
    let observedRequest: PinnedProbeRequest | undefined;
    const result = await probeEndpoint('https://example.com:8443/health?full=1', {
      resolver: publicResolver,
      transport: async (request) => {
        observedRequest = request;
        return { status: 200 };
      },
    });

    expect(result.status).toBe('up');
    expect(result.httpStatus).toBe(200);
    expect(observedRequest).toEqual({
      url: 'https://example.com:8443/health?full=1',
      protocol: 'https:',
      hostname: 'example.com',
      hostHeader: 'example.com:8443',
      address: '93.184.216.34',
      family: 4,
      port: 8443,
      path: '/health?full=1',
      timeoutMs: 8_000,
    });
  });

  it('reports redirects as degraded without following them', async () => {
    const transport = vi.fn(async () => ({ status: 302 }));
    const result = await probeEndpoint('https://example.com/redirect', {
      resolver: publicResolver,
      transport,
    });

    expect(result.status).toBe('degraded');
    expect(result.reason).toBe('redirect not followed');
    expect(transport).toHaveBeenCalledOnce();
  });

  it('reports transport errors as down', async () => {
    const result = await probeEndpoint('https://example.com/down', {
      resolver: publicResolver,
      transport: async () => {
        throw new Error('ECONNREFUSED');
      },
    });

    expect(result.status).toBe('down');
    expect(result.reason).toBe('ECONNREFUSED');
  });

  it('rejects invalid timeout configuration before transport', async () => {
    const transport = vi.fn();
    const result = await probeEndpoint('https://example.com/health', {
      resolver: publicResolver,
      transport,
      timeoutMs: 0,
    });

    expect(result.status).toBe('blocked');
    expect(result.reason).toContain('timeout');
    expect(transport).not.toHaveBeenCalled();
  });
});
