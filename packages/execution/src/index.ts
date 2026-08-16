import { isAddress, type Address, type Hex } from 'viem';

export const POLICY_VERSION = 'v0.1.0' as const;

export type PolicyCheckCode =
  | 'invalid-policy'
  | 'invalid-intent'
  | 'invalid-usage'
  | 'policy-disabled'
  | 'not-yet-valid'
  | 'expired'
  | 'chain-mismatch'
  | 'agent-mismatch'
  | 'principal-mismatch'
  | 'call-not-allowed'
  | 'protocol-not-allowed'
  | 'native-value-exceeded'
  | 'native-daily-limit-exceeded'
  | 'token-not-allowed'
  | 'token-value-exceeded'
  | 'token-daily-limit-exceeded'
  | 'transaction-daily-limit-exceeded'
  | 'slippage-required'
  | 'slippage-exceeded'
  | 'intent-in-future';

export interface PolicyCallRule {
  target: Address;
  selectors: readonly Hex[];
  protocol?: string;
  maxNativeValue?: bigint;
  maxSlippageBps?: number;
  requireSlippage?: boolean;
}

export interface PolicyTokenLimit {
  token: Address;
  maxPerTransaction: bigint;
  maxPerDay: bigint;
}

export interface ExecutionPolicy {
  version: string;
  enabled: boolean;
  chainId: number;
  agentId: string;
  principal: Address;
  validAfter?: number;
  expiresAt: number;
  calls: readonly PolicyCallRule[];
  maxNativeValuePerTransaction: bigint;
  maxNativeValuePerDay: bigint;
  maxTransactionsPerDay?: number;
  tokenLimits: readonly PolicyTokenLimit[];
}

export interface TokenTransferIntent {
  token: Address;
  amount: bigint;
}

export interface ExecutionIntent {
  chainId: number;
  agentId: string;
  principal: Address;
  target: Address;
  selector: Hex;
  nativeValue: bigint;
  tokenTransfers: readonly TokenTransferIntent[];
  protocol?: string;
  slippageBps?: number;
  requestedAt: number;
}

export interface PolicyUsage {
  nativeSpentToday: bigint;
  tokenSpentToday: readonly TokenTransferIntent[];
  transactionsToday: number;
}

export interface PolicyCheck {
  code: PolicyCheckCode;
  passed: boolean;
  detail: string;
}

export interface PolicyDecision {
  approved: boolean;
  policyVersion: string;
  checks: readonly PolicyCheck[];
  rejectionReasons: readonly PolicyCheckCode[];
}

export interface PolicyValidation {
  valid: boolean;
  errors: readonly string[];
}

export function validateExecutionPolicy(policy: unknown): PolicyValidation {
  const errors: string[] = [];
  if (!isRecord(policy)) return { valid: false, errors: ['policy must be an object'] };

  if (policy.version !== POLICY_VERSION) {
    errors.push(`unsupported policy version: ${String(policy.version)}`);
  }
  if (typeof policy.enabled !== 'boolean') errors.push('enabled must be boolean');
  if (!isPositiveSafeInteger(policy.chainId)) {
    errors.push('chainId must be a positive safe integer');
  }
  if (!isDecimalId(policy.agentId)) {
    errors.push('agentId must be a non-negative decimal string');
  }
  if (!isNonZeroAddress(policy.principal)) {
    errors.push('principal must be a non-zero address');
  }
  if (policy.validAfter !== undefined && !isNonNegativeSafeInteger(policy.validAfter)) {
    errors.push('validAfter must be a non-negative safe integer');
  }
  if (!isNonNegativeSafeInteger(policy.expiresAt)) {
    errors.push('expiresAt must be a non-negative safe integer');
  }
  if (
    isNonNegativeSafeInteger(policy.validAfter) &&
    isNonNegativeSafeInteger(policy.expiresAt) &&
    policy.expiresAt <= policy.validAfter
  ) {
    errors.push('expiresAt must be after validAfter');
  }
  if (!isBigint(policy.maxNativeValuePerTransaction)) {
    errors.push('maxNativeValuePerTransaction must be bigint');
  } else if (policy.maxNativeValuePerTransaction < 0n) {
    errors.push('maxNativeValuePerTransaction must be non-negative');
  }
  if (!isBigint(policy.maxNativeValuePerDay)) {
    errors.push('maxNativeValuePerDay must be bigint');
  } else if (policy.maxNativeValuePerDay < 0n) {
    errors.push('maxNativeValuePerDay must be non-negative');
  }
  if (
    isBigint(policy.maxNativeValuePerTransaction) &&
    isBigint(policy.maxNativeValuePerDay) &&
    policy.maxNativeValuePerDay < policy.maxNativeValuePerTransaction
  ) {
    errors.push('maxNativeValuePerDay must cover maxNativeValuePerTransaction');
  }
  if (
    policy.maxTransactionsPerDay !== undefined &&
    !isPositiveSafeInteger(policy.maxTransactionsPerDay)
  ) {
    errors.push('maxTransactionsPerDay must be a positive safe integer');
  }
  if (!Array.isArray(policy.calls) || policy.calls.length === 0) {
    errors.push('calls must contain at least one allowlisted rule');
  } else {
    validateCallRules(policy.calls, errors);
  }
  if (!Array.isArray(policy.tokenLimits)) {
    errors.push('tokenLimits must be an array');
  } else {
    validateTokenLimits(policy.tokenLimits, errors);
  }

  return { valid: errors.length === 0, errors };
}

export function validateExecutionIntent(intent: unknown): PolicyValidation {
  const errors: string[] = [];
  if (!isRecord(intent)) return { valid: false, errors: ['intent must be an object'] };

  if (!isPositiveSafeInteger(intent.chainId)) {
    errors.push('chainId must be a positive safe integer');
  }
  if (!isDecimalId(intent.agentId)) {
    errors.push('agentId must be a non-negative decimal string');
  }
  if (!isNonZeroAddress(intent.principal)) {
    errors.push('principal must be a non-zero address');
  }
  if (!isNonZeroAddress(intent.target)) errors.push('target must be a non-zero address');
  if (!isSelector(intent.selector)) errors.push('selector must be exactly four bytes');
  if (!isBigint(intent.nativeValue) || intent.nativeValue < 0n) {
    errors.push('nativeValue must be non-negative bigint');
  }
  if (!isNonNegativeSafeInteger(intent.requestedAt)) {
    errors.push('requestedAt must be a non-negative safe integer');
  }
  if (intent.protocol !== undefined && !isNonEmptyString(intent.protocol)) {
    errors.push('protocol must be non-empty');
  }
  if (intent.slippageBps !== undefined && !isBps(intent.slippageBps)) {
    errors.push('slippageBps must be between 0 and 10000');
  }
  if (!Array.isArray(intent.tokenTransfers)) {
    errors.push('tokenTransfers must be an array');
  } else {
    for (const transfer of intent.tokenTransfers) {
      if (!isRecord(transfer)) {
        errors.push('token transfer must be an object');
        continue;
      }
      if (!isNonZeroAddress(transfer.token)) {
        errors.push('token transfer token must be a non-zero address');
      }
      if (!isBigint(transfer.amount) || transfer.amount <= 0n) {
        errors.push('token transfer amount must be positive bigint');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validatePolicyUsage(usage: unknown): PolicyValidation {
  const errors: string[] = [];
  if (!isRecord(usage)) return { valid: false, errors: ['usage must be an object'] };

  if (!isBigint(usage.nativeSpentToday) || usage.nativeSpentToday < 0n) {
    errors.push('nativeSpentToday must be non-negative bigint');
  }
  if (!isNonNegativeSafeInteger(usage.transactionsToday)) {
    errors.push('transactionsToday must be a non-negative safe integer');
  }
  if (!Array.isArray(usage.tokenSpentToday)) {
    errors.push('tokenSpentToday must be an array');
  } else {
    for (const spent of usage.tokenSpentToday) {
      if (!isRecord(spent)) {
        errors.push('token usage entry must be an object');
        continue;
      }
      if (!isNonZeroAddress(spent.token)) {
        errors.push('token usage token must be a non-zero address');
      }
      if (!isBigint(spent.amount) || spent.amount < 0n) {
        errors.push('token usage amount must be non-negative bigint');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function evaluateExecutionPolicy(
  policy: unknown,
  intent: unknown,
  usage: unknown,
  now: unknown,
): PolicyDecision {
  const checks: PolicyCheck[] = [];
  const policyValidation = validateExecutionPolicy(policy);
  if (!policyValidation.valid) {
    checks.push(fail('invalid-policy', policyValidation.errors.join('; ')));
    return decision(policyVersionForDecision(policy), checks);
  }

  const validPolicy = policy as ExecutionPolicy;
  const intentValidation = validateExecutionIntent(intent);
  if (!intentValidation.valid) {
    checks.push(fail('invalid-intent', intentValidation.errors.join('; ')));
    return decision(validPolicy.version, checks);
  }

  const usageValidation = validatePolicyUsage(usage);
  if (!usageValidation.valid) {
    checks.push(fail('invalid-usage', usageValidation.errors.join('; ')));
    return decision(validPolicy.version, checks);
  }
  if (!isNonNegativeSafeInteger(now)) {
    checks.push(fail('invalid-intent', 'evaluation time must be a non-negative safe integer'));
    return decision(validPolicy.version, checks);
  }

  const validIntent = intent as ExecutionIntent;
  const validUsage = usage as PolicyUsage;

  if (!validPolicy.enabled) checks.push(fail('policy-disabled', 'policy is disabled'));
  if (validPolicy.validAfter !== undefined && now < validPolicy.validAfter) {
    checks.push(fail('not-yet-valid', 'policy validity window has not started'));
  }
  if (now >= validPolicy.expiresAt) checks.push(fail('expired', 'policy has expired'));
  if (validIntent.requestedAt > now) {
    checks.push(fail('intent-in-future', 'intent timestamp is in the future'));
  }
  if (validIntent.chainId !== validPolicy.chainId) {
    checks.push(fail('chain-mismatch', 'intent chain does not match policy'));
  }
  if (validIntent.agentId !== validPolicy.agentId) {
    checks.push(fail('agent-mismatch', 'intent agent does not match policy'));
  }
  if (!sameAddress(validIntent.principal, validPolicy.principal)) {
    checks.push(fail('principal-mismatch', 'intent principal does not match policy'));
  }

  const candidateRules = validPolicy.calls.filter(
    (candidate) =>
      sameAddress(candidate.target, validIntent.target) &&
      candidate.selectors.some((selector) => sameHex(selector, validIntent.selector)),
  );
  const rule = findProtocolRule(candidateRules, validIntent.protocol);
  if (candidateRules.length === 0) {
    checks.push(fail('call-not-allowed', 'target and selector are not allowlisted'));
  } else if (!rule) {
    checks.push(fail('protocol-not-allowed', 'intent protocol does not match call rule'));
  } else {
    const maxNativeValue = minimumBigint(
      validPolicy.maxNativeValuePerTransaction,
      rule.maxNativeValue ?? validPolicy.maxNativeValuePerTransaction,
    );
    if (validIntent.nativeValue > maxNativeValue) {
      checks.push(fail('native-value-exceeded', 'native value exceeds transaction limit'));
    }
    checkSlippage(rule, validIntent, checks);
  }

  if (validUsage.nativeSpentToday + validIntent.nativeValue > validPolicy.maxNativeValuePerDay) {
    checks.push(fail('native-daily-limit-exceeded', 'native value exceeds policy daily limit'));
  }
  if (
    validPolicy.maxTransactionsPerDay !== undefined &&
    validUsage.transactionsToday + 1 > validPolicy.maxTransactionsPerDay
  ) {
    checks.push(
      fail('transaction-daily-limit-exceeded', 'daily transaction count would be exceeded'),
    );
  }
  checkTokenTransfers(validPolicy, validIntent, validUsage, checks);

  return decision(validPolicy.version, checks);
}

function validateCallRules(rules: readonly unknown[], errors: string[]): void {
  const seen = new Set<string>();
  for (const candidate of rules) {
    if (!isRecord(candidate)) {
      errors.push('call rule must be an object');
      continue;
    }

    const validTarget = isNonZeroAddress(candidate.target);
    if (!validTarget) errors.push('call target must be a non-zero address');
    const validProtocol = candidate.protocol === undefined || isNonEmptyString(candidate.protocol);
    if (!validProtocol) errors.push('call protocol must be non-empty');

    if (!Array.isArray(candidate.selectors) || candidate.selectors.length === 0) {
      errors.push('call selectors must be non-empty');
    } else {
      for (const selector of candidate.selectors) {
        const validSelector = isSelector(selector);
        if (!validSelector) errors.push('call selector must be exactly four bytes');
        if (validTarget && validSelector && validProtocol) {
          const target = candidate.target as Address;
          const key = `${target.toLowerCase()}:${selector.toLowerCase()}:${normalizeProtocol(candidate.protocol as string | undefined)}`;
          if (seen.has(key)) {
            errors.push('call rules must not duplicate target, selector, and protocol');
          }
          seen.add(key);
        }
      }
    }
    if (
      candidate.maxNativeValue !== undefined &&
      (!isBigint(candidate.maxNativeValue) || candidate.maxNativeValue < 0n)
    ) {
      errors.push('call maxNativeValue must be non-negative bigint');
    }
    if (candidate.maxSlippageBps !== undefined && !isBps(candidate.maxSlippageBps)) {
      errors.push('call maxSlippageBps must be between 0 and 10000');
    }
    if (candidate.requireSlippage !== undefined && typeof candidate.requireSlippage !== 'boolean') {
      errors.push('requireSlippage must be boolean');
    }
  }
}

function validateTokenLimits(limits: readonly unknown[], errors: string[]): void {
  const seen = new Set<string>();
  for (const candidate of limits) {
    if (!isRecord(candidate)) {
      errors.push('token limit must be an object');
      continue;
    }

    if (!isNonZeroAddress(candidate.token)) {
      errors.push('token limit token must be a non-zero address');
    } else {
      const key = candidate.token.toLowerCase();
      if (seen.has(key)) errors.push('token limits must not duplicate a token');
      seen.add(key);
    }
    if (!isBigint(candidate.maxPerTransaction) || candidate.maxPerTransaction < 0n) {
      errors.push('token maxPerTransaction must be non-negative bigint');
    }
    if (!isBigint(candidate.maxPerDay) || candidate.maxPerDay < 0n) {
      errors.push('token maxPerDay must be non-negative bigint');
    }
    if (
      isBigint(candidate.maxPerTransaction) &&
      isBigint(candidate.maxPerDay) &&
      candidate.maxPerDay < candidate.maxPerTransaction
    ) {
      errors.push('token maxPerDay must cover maxPerTransaction');
    }
  }
}

function findProtocolRule(
  rules: readonly PolicyCallRule[],
  protocol: string | undefined,
): PolicyCallRule | undefined {
  const normalizedProtocol = normalizeProtocol(protocol);
  const exactRule = rules.find(
    (rule) =>
      rule.protocol !== undefined && normalizeProtocol(rule.protocol) === normalizedProtocol,
  );
  return exactRule ?? rules.find((rule) => rule.protocol === undefined);
}

function checkSlippage(rule: PolicyCallRule, intent: ExecutionIntent, checks: PolicyCheck[]): void {
  if (
    intent.slippageBps === undefined &&
    (rule.requireSlippage === true || rule.maxSlippageBps !== undefined)
  ) {
    checks.push(fail('slippage-required', 'call rule requires slippage metadata'));
    return;
  }
  if (
    rule.maxSlippageBps !== undefined &&
    intent.slippageBps !== undefined &&
    intent.slippageBps > rule.maxSlippageBps
  ) {
    checks.push(fail('slippage-exceeded', 'intent slippage exceeds call limit'));
  }
}

function checkTokenTransfers(
  policy: ExecutionPolicy,
  intent: ExecutionIntent,
  usage: PolicyUsage,
  checks: PolicyCheck[],
): void {
  const requestedByToken = aggregateTokenAmounts(intent.tokenTransfers);
  const spentByToken = aggregateTokenAmounts(usage.tokenSpentToday);

  for (const transfer of requestedByToken.values()) {
    const limit = policy.tokenLimits.find((candidate) =>
      sameAddress(candidate.token, transfer.token),
    );
    if (!limit) {
      checks.push(fail('token-not-allowed', `token ${transfer.token} is not allowlisted`));
      continue;
    }
    if (transfer.amount > limit.maxPerTransaction) {
      checks.push(
        fail('token-value-exceeded', `token ${transfer.token} exceeds transaction limit`),
      );
    }
    const spentToday = spentByToken.get(transfer.token.toLowerCase())?.amount ?? 0n;
    if (spentToday + transfer.amount > limit.maxPerDay) {
      checks.push(
        fail('token-daily-limit-exceeded', `token ${transfer.token} exceeds daily limit`),
      );
    }
  }
}

function aggregateTokenAmounts(
  transfers: readonly TokenTransferIntent[],
): Map<string, TokenTransferIntent> {
  const aggregated = new Map<string, TokenTransferIntent>();
  for (const transfer of transfers) {
    const key = transfer.token.toLowerCase();
    const existing = aggregated.get(key);
    aggregated.set(key, {
      token: existing?.token ?? transfer.token,
      amount: (existing?.amount ?? 0n) + transfer.amount,
    });
  }
  return aggregated;
}

function decision(policyVersion: string, checks: readonly PolicyCheck[]): PolicyDecision {
  const rejectionReasons = checks.filter((check) => !check.passed).map((check) => check.code);
  return {
    approved: rejectionReasons.length === 0,
    policyVersion,
    checks,
    rejectionReasons: [...new Set(rejectionReasons)],
  };
}

function fail(code: PolicyCheckCode, detail: string): PolicyCheck {
  return { code, passed: false, detail };
}

function policyVersionForDecision(policy: unknown): string {
  return isRecord(policy) && typeof policy.version === 'string' ? policy.version : POLICY_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBigint(value: unknown): value is bigint {
  return typeof value === 'bigint';
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isDecimalId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]+$/u.test(value);
}

function isNonZeroAddress(value: unknown): value is Address {
  return typeof value === 'string' && isAddress(value) && !/^0x0{40}$/u.test(value);
}

function isSelector(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{8}$/u.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000;
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function normalizeProtocol(protocol: string | undefined): string {
  return protocol?.trim().toLowerCase() ?? '';
}

function minimumBigint(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
