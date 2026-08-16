import { describe, expect, it } from 'vitest';
import {
  POLICY_VERSION,
  evaluateExecutionPolicy,
  validateExecutionPolicy,
  type ExecutionIntent,
  type ExecutionPolicy,
  type PolicyCheckCode,
  type PolicyUsage,
} from '../src/index.js';

const NOW = 1_800_000_000;
const PRINCIPAL = '0x1111111111111111111111111111111111111111';
const OTHER_PRINCIPAL = '0x2222222222222222222222222222222222222222';
const TARGET = '0x3333333333333333333333333333333333333333';
const OTHER_TARGET = '0x4444444444444444444444444444444444444444';
const TOKEN = '0x5555555555555555555555555555555555555555';
const OTHER_TOKEN = '0x6666666666666666666666666666666666666666';
const SELECTOR = '0xa9059cbb';
const OTHER_SELECTOR = '0x095ea7b3';

function basePolicy(overrides: Partial<ExecutionPolicy> = {}): ExecutionPolicy {
  return {
    version: POLICY_VERSION,
    enabled: true,
    chainId: 56,
    agentId: '42',
    principal: PRINCIPAL,
    validAfter: NOW - 100,
    expiresAt: NOW + 100,
    calls: [
      {
        target: TARGET,
        selectors: [SELECTOR],
        protocol: 'venus',
        maxNativeValue: 5n,
        maxSlippageBps: 100,
        requireSlippage: true,
      },
    ],
    maxNativeValuePerTransaction: 10n,
    maxNativeValuePerDay: 100n,
    maxTransactionsPerDay: 5,
    tokenLimits: [{ token: TOKEN, maxPerTransaction: 100n, maxPerDay: 500n }],
    ...overrides,
  };
}

function baseIntent(overrides: Partial<ExecutionIntent> = {}): ExecutionIntent {
  return {
    chainId: 56,
    agentId: '42',
    principal: PRINCIPAL,
    target: TARGET,
    selector: SELECTOR,
    nativeValue: 1n,
    tokenTransfers: [{ token: TOKEN, amount: 20n }],
    protocol: ' Venus ',
    slippageBps: 50,
    requestedAt: NOW,
    ...overrides,
  };
}

function baseUsage(overrides: Partial<PolicyUsage> = {}): PolicyUsage {
  return {
    nativeSpentToday: 10n,
    tokenSpentToday: [{ token: TOKEN, amount: 100n }],
    transactionsToday: 1,
    ...overrides,
  };
}

function reasons(
  policy: unknown = basePolicy(),
  intent: unknown = baseIntent(),
  usage: unknown = baseUsage(),
  now: unknown = NOW,
): readonly PolicyCheckCode[] {
  return evaluateExecutionPolicy(policy, intent, usage, now).rejectionReasons;
}

describe('deterministic execution policy (M5)', () => {
  it('approves a fully compliant normalized intent', () => {
    expect(evaluateExecutionPolicy(basePolicy(), baseIntent(), baseUsage(), NOW)).toEqual({
      approved: true,
      policyVersion: POLICY_VERSION,
      checks: [],
      rejectionReasons: [],
    });
  });

  it('returns identical decisions for identical explicit inputs', () => {
    const policy = basePolicy();
    const intent = baseIntent();
    const usage = baseUsage();
    expect(evaluateExecutionPolicy(policy, intent, usage, NOW)).toEqual(
      evaluateExecutionPolicy(policy, intent, usage, NOW),
    );
  });

  it('rejects disabled, not-yet-valid, expired, and future-dated requests', () => {
    expect(reasons(basePolicy({ enabled: false }))).toContain('policy-disabled');
    expect(reasons(basePolicy({ validAfter: NOW + 1, expiresAt: NOW + 100 }))).toContain(
      'not-yet-valid',
    );
    expect(reasons(basePolicy({ expiresAt: NOW }))).toContain('expired');
    expect(reasons(basePolicy(), baseIntent({ requestedAt: NOW + 1 }))).toContain(
      'intent-in-future',
    );
  });

  it('rejects chain, agent, and principal identity mismatches in stable order', () => {
    expect(
      reasons(basePolicy(), baseIntent({ chainId: 1, agentId: '43', principal: OTHER_PRINCIPAL })),
    ).toEqual(['chain-mismatch', 'agent-mismatch', 'principal-mismatch']);
  });

  it('rejects unknown targets and selectors', () => {
    expect(reasons(basePolicy(), baseIntent({ target: OTHER_TARGET }))).toContain(
      'call-not-allowed',
    );
    expect(reasons(basePolicy(), baseIntent({ selector: OTHER_SELECTOR }))).toContain(
      'call-not-allowed',
    );
  });

  it('rejects protocol mismatches while normalizing case and whitespace', () => {
    expect(reasons()).not.toContain('protocol-not-allowed');
    expect(reasons(basePolicy(), baseIntent({ protocol: 'aave' }))).toContain(
      'protocol-not-allowed',
    );
  });

  it('selects an exact protocol rule before any other matching call rule', () => {
    const calls = [
      {
        target: TARGET,
        selectors: [SELECTOR],
        protocol: 'venus',
        maxNativeValue: 1n,
      },
      {
        target: TARGET,
        selectors: [SELECTOR],
        protocol: 'aave',
        maxNativeValue: 5n,
      },
    ] as const;
    expect(
      evaluateExecutionPolicy(
        basePolicy({ calls }),
        baseIntent({ protocol: 'AAVE', nativeValue: 4n, slippageBps: undefined }),
        baseUsage(),
        NOW,
      ).approved,
    ).toBe(true);
  });

  it('enforces the strictest call and policy native transaction limit', () => {
    expect(reasons(basePolicy(), baseIntent({ nativeValue: 6n }))).toContain(
      'native-value-exceeded',
    );
    expect(
      reasons(
        basePolicy({
          calls: [{ target: TARGET, selectors: [SELECTOR], maxNativeValue: 20n }],
        }),
        baseIntent({ nativeValue: 11n, protocol: undefined, slippageBps: undefined }),
      ),
    ).toContain('native-value-exceeded');
  });

  it('enforces native daily limits', () => {
    expect(
      reasons(basePolicy(), baseIntent({ nativeValue: 2n }), baseUsage({ nativeSpentToday: 99n })),
    ).toContain('native-daily-limit-exceeded');
  });

  it('rejects non-allowlisted token transfers', () => {
    expect(
      reasons(basePolicy(), baseIntent({ tokenTransfers: [{ token: OTHER_TOKEN, amount: 1n }] })),
    ).toContain('token-not-allowed');
  });

  it('aggregates duplicate intent transfers before enforcing per-transaction limits', () => {
    expect(
      reasons(
        basePolicy(),
        baseIntent({
          tokenTransfers: [
            { token: TOKEN, amount: 60n },
            { token: TOKEN, amount: 50n },
          ],
        }),
      ),
    ).toContain('token-value-exceeded');
  });

  it('aggregates duplicate usage entries before enforcing token daily limits', () => {
    expect(
      reasons(
        basePolicy(),
        baseIntent({ tokenTransfers: [{ token: TOKEN, amount: 60n }] }),
        baseUsage({
          tokenSpentToday: [
            { token: TOKEN, amount: 200n },
            { token: TOKEN, amount: 250n },
          ],
        }),
      ),
    ).toContain('token-daily-limit-exceeded');
  });

  it('enforces the daily transaction count', () => {
    expect(reasons(basePolicy(), baseIntent(), baseUsage({ transactionsToday: 5 }))).toContain(
      'transaction-daily-limit-exceeded',
    );
  });

  it('rejects missing and excessive slippage metadata', () => {
    expect(reasons(basePolicy(), baseIntent({ slippageBps: undefined }))).toContain(
      'slippage-required',
    );
    expect(reasons(basePolicy(), baseIntent({ slippageBps: 101 }))).toContain('slippage-exceeded');
  });

  it('returns invalid-policy instead of throwing for malformed policies', () => {
    const malformed = { ...basePolicy(), calls: [null] };
    expect(() => evaluateExecutionPolicy(malformed, baseIntent(), baseUsage(), NOW)).not.toThrow();
    expect(reasons(malformed)).toEqual(['invalid-policy']);
  });

  it('returns invalid-intent instead of throwing for malformed intents', () => {
    const malformed = { ...baseIntent(), tokenTransfers: [null] };
    expect(() => evaluateExecutionPolicy(basePolicy(), malformed, baseUsage(), NOW)).not.toThrow();
    expect(reasons(basePolicy(), malformed)).toEqual(['invalid-intent']);
  });

  it('returns invalid-usage instead of allowing malformed or negative usage', () => {
    const malformed = {
      nativeSpentToday: -1n,
      tokenSpentToday: [null],
      transactionsToday: -1,
    };
    expect(() => evaluateExecutionPolicy(basePolicy(), baseIntent(), malformed, NOW)).not.toThrow();
    expect(reasons(basePolicy(), baseIntent(), malformed)).toEqual(['invalid-usage']);
  });

  it('fails closed when no policy is supplied', () => {
    expect(
      evaluateExecutionPolicy(undefined, baseIntent(), baseUsage(), NOW).rejectionReasons,
    ).toEqual(['invalid-policy']);
  });

  it('rejects an empty call allowlist', () => {
    expect(validateExecutionPolicy(basePolicy({ calls: [] }))).toMatchObject({ valid: false });
  });

  it('rejects duplicate call rules and duplicate token limits', () => {
    const rule = basePolicy().calls[0];
    const limit = basePolicy().tokenLimits[0];
    expect(
      validateExecutionPolicy(basePolicy({ calls: [rule!, rule!], tokenLimits: [limit!, limit!] }))
        .errors,
    ).toEqual(
      expect.arrayContaining([
        'call rules must not duplicate target, selector, and protocol',
        'token limits must not duplicate a token',
      ]),
    );
  });

  it('rejects an invalid explicit evaluation timestamp', () => {
    expect(reasons(basePolicy(), baseIntent(), baseUsage(), -1)).toEqual(['invalid-intent']);
  });
});
