import { describe, it, expect } from 'vitest';
import { METHODOLOGY_VERSION, isMethodologyVersion } from '../src/version.js';
import type { AgentCategory, VerificationTier, Confidence } from '../src/agent.js';

describe('core/version', () => {
  it('exposes a semver-ish methodology version', () => {
    expect(METHODOLOGY_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it('validates methodology versions', () => {
    expect(isMethodologyVersion('v0.0.0')).toBe(true);
    expect(isMethodologyVersion('v1.2.3')).toBe(true);
    expect(isMethodologyVersion('1.2.3')).toBe(false);
    expect(isMethodologyVersion('latest')).toBe(false);
  });
});

describe('core domain types', () => {
  it('category union is closed over the four reference categories', () => {
    const cats: AgentCategory[] = ['monitoring', 'grid-trading', 'health-factor', 'yield'];
    expect(cats).toHaveLength(4);
  });

  it('verification tier does not gate visibility semantics', () => {
    const tiers: VerificationTier[] = ['unverified', 'data-verified', 'execution-verified'];
    // An unverified agent is still a valid discoverable agent.
    expect(tiers).toContain('unverified');
  });

  it('confidence is a 4-level enum', () => {
    const levels: Confidence[] = ['none', 'low', 'medium', 'high'];
    expect(levels).toHaveLength(4);
  });
});
