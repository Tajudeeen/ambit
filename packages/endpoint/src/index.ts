import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF-protected endpoint liveness verifier (brief §21).
 *
 * Endpoint verification is SSRF-sensitive: a malicious agentURI could point our
 * crawler at 169.254.169.254 (cloud metadata), 127.0.0.1, or an internal host.
 * We resolve the hostname and BLOCK:
 *   - loopback / private / link-local / reserved IP ranges
 *   - non-http(s) schemes
 *   - redirect escapes back to blocked ranges (best-effort, no auto-follow)
 *
 * The verifier never follows redirects and uses a strict timeout. It returns a
 * structured result so the indexer can record latency/status with provenance
 * without ever becoming an internal-network scanner.
 */

const BLOCKED_NETS: Array<(ip: string) => boolean> = [
  (ip) => isIP(ip) === 4 && ip.startsWith('10.'),                // RFC1918
  (ip) => isIP(ip) === 4 && ip.startsWith('192.168.'),           // RFC1918
  (ip) => isIP(ip) === 4 && /^172\.(1[6-9]|2\d|3[01])\./.test(ip), // RFC1918
  (ip) => isIP(ip) === 4 && ip.startsWith('127.'),                // loopback
  (ip) => isIP(ip) === 4 && ip.startsWith('169.254.'),            // link-local / cloud metadata
  (ip) => isIP(ip) === 6 && ip === '::1',                         // ipv6 loopback
  (ip) => isIP(ip) === 6 && ip.toLowerCase().startsWith('fc'),   // ULA
  (ip) => isIP(ip) === 6 && ip.toLowerCase().startsWith('fe80'), // link-local
];

export function isBlockedAddress(ip: string): boolean {
  if (isIP(ip) === 0) return true; // not an IP we recognize -> treat as blocked host
  return BLOCKED_NETS.some((f) => f(ip));
}

export interface ProbeResult {
  url: string;
  status: 'up' | 'down' | 'degraded' | 'blocked';
  httpStatus?: number;
  latencyMs?: number;
  reason?: string;
  checkedAt: string;
}

/** Resolve all A/AAAA records for a host and fail closed if ANY is blocked. */
async function hostAllowed(hostname: string): Promise<{ ok: boolean; reason?: string }> {
  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) return { ok: false, reason: `blocked IP ${hostname}` };
    return { ok: true };
  }
  let addrs: string[];
  try {
    const recs = await lookup(hostname, { all: true });
    addrs = recs.map((r) => r.address);
  } catch {
    return { ok: false, reason: `dns resolution failed for ${hostname}` };
  }
  for (const a of addrs) {
    if (isBlockedAddress(a)) return { ok: false, reason: `blocked resolved IP ${a} for ${hostname}` };
  }
  return { ok: true };
}

export async function probeEndpoint(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8_000,
): Promise<ProbeResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, status: 'blocked', reason: 'invalid URL', checkedAt: new Date().toISOString() };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url, status: 'blocked', reason: `scheme ${parsed.protocol} not allowed`, checkedAt: new Date().toISOString() };
  }
  const hostCheck = await hostAllowed(parsed.hostname);
  if (!hostCheck.ok) {
    return { url, status: 'blocked', reason: hostCheck.reason, checkedAt: new Date().toISOString() };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal });
    const latencyMs = Date.now() - start;
    // manual redirect: do not follow (prevents redirect-based SSRF bypass)
    if (res.status >= 300 && res.status < 400) {
      return { url, status: 'degraded', httpStatus: res.status, latencyMs, reason: 'redirect not followed', checkedAt: new Date().toISOString() };
    }
    return { url, status: res.ok ? 'up' : 'degraded', httpStatus: res.status, latencyMs, checkedAt: new Date().toISOString() };
  } catch (e) {
    return { url, status: 'down', reason: e instanceof Error ? e.message : 'probe failed', latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}
