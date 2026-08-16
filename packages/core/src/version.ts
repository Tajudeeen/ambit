/**
 * Methodology versioning.
 *
 * The trust/risk scoring methodology is versioned and stored alongside every
 * score so that a score can always be reproduced and audited against the exact
 * formula that produced it. Bump the MAJOR/MINOR/PATCH when the formula changes.
 */
export const METHODOLOGY_VERSION = 'v0.0.0' as const;

export function isMethodologyVersion(v: string): boolean {
  return /^v\d+\.\d+\.\d+$/.test(v);
}
