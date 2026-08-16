import type { AgentRegistrationFile } from './abis.js';

/**
 * Validate a resolved agentURI payload against the ERC-8004 Agent Registration
 * File shape (eips.ethereum.org/EIPS/eip-8004 §Agent URI). We intentionally
 * DO NOT silently coerce; invalid metadata is recorded and the agent stays
 * discoverable (R-VIS) but flagged as having unverified metadata.
 */
export type ValidationResult =
  | { ok: true; data: AgentRegistrationFile }
  | { ok: false; errors: string[] };

export function validateRegistrationFile(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['payload is not an object'] };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) errors.push('missing name');
  if (typeof r.description !== 'string') errors.push('missing description');
  if (typeof r.x402Support !== 'boolean') errors.push('missing x402Support boolean');
  if (typeof r.active !== 'boolean') errors.push('missing active boolean');
  if (!Array.isArray(r.services)) {
    errors.push('services must be an array');
  } else {
    for (const s of r.services as unknown[]) {
      const svc = s as Record<string, unknown>;
      if (typeof svc?.name !== 'string') errors.push('service missing name');
      if (typeof svc?.endpoint !== 'string') errors.push('service missing endpoint');
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: r as unknown as AgentRegistrationFile };
}

/** Convert an ERC-8004 reputation value (int128 scaled by valueDecimals) to a float. */
export function normalizeReputationValue(value: bigint, valueDecimals: number): number {
  const divisor = 10 ** valueDecimals;
  // bigint -> number is safe for the magnitudes ERC-8004 uses in practice.
  return Number(value) / divisor;
}
