import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const DEFAULT_TIMEOUT_MS = 8_000;

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedProbeRequest {
  url: string;
  protocol: 'http:' | 'https:';
  hostname: string;
  hostHeader: string;
  address: string;
  family: 4 | 6;
  port: number;
  path: string;
  timeoutMs: number;
}

export interface ProbeTransportResponse {
  status: number;
}

export type EndpointResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;
export type ProbeTransport = (request: PinnedProbeRequest) => Promise<ProbeTransportResponse>;

export interface ProbeOptions {
  resolver?: EndpointResolver;
  transport?: ProbeTransport;
  timeoutMs?: number;
}

export interface ProbeResult {
  url: string;
  status: 'up' | 'down' | 'degraded' | 'blocked';
  httpStatus?: number;
  latencyMs?: number;
  reason?: string;
  checkedAt: string;
}

function normalizeIpLiteral(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function ipv4Number(address: string): number | null {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  const first = octets[0];
  const second = octets[1];
  const third = octets[2];
  const fourth = octets[3];
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    return null;
  }

  return ((first << 24) >>> 0) + (second << 16) + (third << 8) + fourth;
}

function inIpv4Range(address: number, network: number, prefixLength: number): boolean {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (address & mask) === (network & mask);
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return true;

  const blockedRanges: ReadonlyArray<readonly [string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];

  return blockedRanges.some(([network, prefixLength]) => {
    const networkValue = ipv4Number(network);
    return networkValue === null || inIpv4Range(value, networkValue, prefixLength);
  });
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0];
  if (!normalized) return true;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('2001:db8:')) return true;
  if (normalized.startsWith('::ffff:')) {
    const mappedAddress = normalized.slice('::ffff:'.length);
    return isIP(mappedAddress) !== 4 || isBlockedIpv4(mappedAddress);
  }
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const normalized = normalizeIpLiteral(address);
  const family = isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return true;
}

async function systemResolver(hostname: string): Promise<readonly ResolvedAddress[]> {
  const literal = normalizeIpLiteral(hostname);
  const literalFamily = isIP(literal);
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: literal, family: literalFamily }];
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.flatMap((record) =>
    record.family === 4 || record.family === 6
      ? [{ address: record.address, family: record.family }]
      : [],
  );
}

async function pinnedTransport(request: PinnedProbeRequest): Promise<ProbeTransportResponse> {
  return new Promise((resolve, reject) => {
    const commonOptions = {
      hostname: request.address,
      family: request.family,
      port: request.port,
      path: request.path,
      method: 'HEAD',
      headers: { host: request.hostHeader },
    };
    const clientRequest =
      request.protocol === 'https:'
        ? httpsRequest({ ...commonOptions, servername: request.hostname })
        : httpRequest(commonOptions);

    clientRequest.once('response', (response) => {
      const status = response.statusCode;
      response.resume();
      if (status === undefined) {
        reject(new Error('endpoint response omitted HTTP status'));
        return;
      }
      resolve({ status });
    });
    clientRequest.once('error', reject);
    clientRequest.setTimeout(request.timeoutMs, () => {
      clientRequest.destroy(new Error(`endpoint probe timed out after ${request.timeoutMs}ms`));
    });
    clientRequest.end();
  });
}

async function approvedAddresses(
  hostname: string,
  resolver: EndpointResolver,
): Promise<{ addresses?: readonly ResolvedAddress[]; reason?: string }> {
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    return { reason: `dns resolution failed for ${hostname}` };
  }

  if (addresses.length === 0) {
    return { reason: `dns resolution returned no addresses for ${hostname}` };
  }
  for (const record of addresses) {
    if (isBlockedAddress(record.address)) {
      return { reason: `blocked resolved IP ${record.address} for ${hostname}` };
    }
  }
  return { addresses };
}

export async function probeEndpoint(url: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const checkedAt = new Date().toISOString();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, status: 'blocked', reason: 'invalid URL', checkedAt };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url, status: 'blocked', reason: `scheme ${parsed.protocol} not allowed`, checkedAt };
  }
  if (parsed.username || parsed.password) {
    return { url, status: 'blocked', reason: 'URL credentials are not allowed', checkedAt };
  }

  const hostname = normalizeIpLiteral(parsed.hostname);
  const resolution = await approvedAddresses(hostname, options.resolver ?? systemResolver);
  const selectedAddress = resolution.addresses?.[0];
  if (!selectedAddress) {
    return { url, status: 'blocked', reason: resolution.reason, checkedAt };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    return { url, status: 'blocked', reason: 'timeout must be a positive safe integer', checkedAt };
  }

  const start = Date.now();
  try {
    const response = await (options.transport ?? pinnedTransport)({
      url: parsed.toString(),
      protocol: parsed.protocol,
      hostname,
      hostHeader: parsed.host,
      address: selectedAddress.address,
      family: selectedAddress.family,
      port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
      path: `${parsed.pathname}${parsed.search}`,
      timeoutMs,
    });
    const latencyMs = Date.now() - start;
    if (response.status >= 300 && response.status < 400) {
      return {
        url,
        status: 'degraded',
        httpStatus: response.status,
        latencyMs,
        reason: 'redirect not followed',
        checkedAt,
      };
    }
    return {
      url,
      status: response.status >= 200 && response.status < 300 ? 'up' : 'degraded',
      httpStatus: response.status,
      latencyMs,
      checkedAt,
    };
  } catch (error) {
    return {
      url,
      status: 'down',
      reason: error instanceof Error ? error.message : 'probe failed',
      latencyMs: Date.now() - start,
      checkedAt,
    };
  }
}
