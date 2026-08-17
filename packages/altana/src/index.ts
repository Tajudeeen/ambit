import {
  BNB,
  BNB_TESTNET,
  createClient,
  type CallPermission,
  type Client,
  type ExecuteResult,
  type Session,
  type SessionPermissions,
  type Signer,
  type SpendPermission,
  type Wallet,
} from '@altananetwork/sdk';
import {
  validateExecutionIntent,
  validateRawExecutionRequest,
  type ExecutionIntent,
  type ExecutionPipelineDecision,
  type RawExecutionRequest,
  type TokenTransferIntent,
} from '@ambit/execution';
import { isAddress, toFunctionSelector, type Address, type Hex } from 'viem';

export const ALTANA_SDK_VERSION = '0.5.1' as const;

export type AltanaNetworkName = 'bnb-mainnet' | 'bnb-testnet';

export type AltanaClient = Pick<
  Client,
  'chains' | 'defaultChainId' | 'execute' | 'grantSession' | 'revokeSession'
>;

export interface RegisteredAltanaSession {
  registration: 'registered';
  grantedAt: number;
  session: Session;
}

export interface AltanaRegisteredSessionGrant {
  permissions: SessionPermissions;
  expiry: number;
  now: number;
  sessionSigner?: Signer;
  feeToken?: Address;
}

export interface AltanaAdminAdapterOptions {
  client: AltanaClient;
  chainId: number;
  wallet: Wallet;
  signer: Signer;
}

export interface AltanaSessionExecutorOptions {
  client: AltanaClient;
  chainId: number;
  registeredSession: RegisteredAltanaSession;
}

export interface AltanaRelaySubmission {
  callsId: Hex;
  transactionHash: Hex;
  status: 'PENDING' | 'CONFIRMED';
}

export type AltanaIntegrationErrorCode =
  | 'invalid-config'
  | 'invalid-grant'
  | 'invalid-session'
  | 'sdk-unavailable'
  | 'invalid-relay-result'
  | 'relay-failed';

export class AltanaIntegrationError extends Error {
  readonly code: AltanaIntegrationErrorCode;

  constructor(code: AltanaIntegrationErrorCode, message: string) {
    super(message);
    this.name = 'AltanaIntegrationError';
    this.code = code;
  }
}

export type AltanaExecutionCheckCode =
  | 'invalid-decision'
  | 'session-expired'
  | 'session-chain-mismatch'
  | 'session-wallet-mismatch'
  | 'session-call-not-allowed'
  | 'session-spend-not-allowed'
  | 'relay-unavailable'
  | 'invalid-relay-result'
  | 'relay-failed';

export interface AltanaExecutionCheck {
  code: AltanaExecutionCheckCode;
  passed: boolean;
  detail: string;
}

export interface AltanaExecutionDecision {
  submitted: boolean;
  checks: readonly AltanaExecutionCheck[];
  rejectionReasons: readonly AltanaExecutionCheckCode[];
  callsId?: Hex;
  transactionHash?: Hex;
  relayStatus?: 'PENDING' | 'CONFIRMED';
}

export function createOfficialAltanaClient(network: AltanaNetworkName): AltanaClient {
  const config = network === 'bnb-mainnet' ? BNB : BNB_TESTNET;
  return createClient({ chains: [config], defaultChainId: config.chainId });
}

export class AltanaAdminAdapter {
  readonly #client: AltanaClient;
  readonly #chainId: number;
  readonly #wallet: Wallet;
  readonly #signer: Signer;

  constructor(options: AltanaAdminAdapterOptions) {
    const errors = validateAdminOptions(options);
    if (errors.length > 0) {
      throw new AltanaIntegrationError('invalid-config', errors.join('; '));
    }
    this.#client = options.client;
    this.#chainId = options.chainId;
    this.#wallet = options.wallet;
    this.#signer = options.signer;
  }

  async grantRegisteredSession(
    input: AltanaRegisteredSessionGrant,
  ): Promise<RegisteredAltanaSession> {
    const errors = validateGrant(input);
    if (errors.length > 0) {
      throw new AltanaIntegrationError('invalid-grant', errors.join('; '));
    }

    let session: unknown;
    try {
      session = await this.#client.grantSession({
        wallet: this.#wallet,
        signer: this.#signer,
        permissions: input.permissions,
        expiry: input.expiry,
        register: true,
        chainId: this.#chainId,
        ...(input.sessionSigner ? { sessionSigner: input.sessionSigner } : {}),
        ...(input.feeToken ? { feeToken: input.feeToken } : {}),
      });
    } catch {
      throw new AltanaIntegrationError('sdk-unavailable', 'Altana session grant failed');
    }

    if (
      !isAltanaSession(session) ||
      !sameAddress(session.walletAddress, this.#wallet.address) ||
      session.expiry !== input.expiry ||
      !permissionsEqual(session.permissions, input.permissions)
    ) {
      throw new AltanaIntegrationError(
        'invalid-session',
        'Altana returned a session that does not match the requested registered grant',
      );
    }

    return { registration: 'registered', grantedAt: input.now, session };
  }

  async revokeSession(
    registeredSessionOrPublicKey: RegisteredAltanaSession | Hex,
    feeToken?: Address,
  ): Promise<AltanaRelaySubmission> {
    if (feeToken !== undefined && !isNonZeroAddress(feeToken)) {
      throw new AltanaIntegrationError('invalid-config', 'feeToken must be a non-zero address');
    }
    const session = isRegisteredSession(registeredSessionOrPublicKey)
      ? registeredSessionOrPublicKey.session
      : registeredSessionOrPublicKey;
    if (!isAltanaSession(session) && !isNonEmptyHex(session)) {
      throw new AltanaIntegrationError('invalid-session', 'session or public key is invalid');
    }

    let result: unknown;
    try {
      result = await this.#client.revokeSession({
        wallet: this.#wallet,
        signer: this.#signer,
        session,
        chainId: this.#chainId,
        ...(feeToken ? { feeToken } : {}),
      });
    } catch {
      throw new AltanaIntegrationError('sdk-unavailable', 'Altana session revocation failed');
    }
    return requireRelaySubmission(result, 'revokeSession');
  }
}

export class AltanaSessionExecutor {
  readonly #client: AltanaClient;
  readonly #chainId: number;
  readonly #registeredSession: RegisteredAltanaSession;

  constructor(options: AltanaSessionExecutorOptions) {
    const errors = validateSessionExecutorOptions(options);
    if (errors.length > 0) {
      throw new AltanaIntegrationError('invalid-config', errors.join('; '));
    }
    this.#client = options.client;
    this.#chainId = options.chainId;
    this.#registeredSession = options.registeredSession;
  }

  async executeApproved(decision: unknown, now: unknown): Promise<AltanaExecutionDecision> {
    const checks: AltanaExecutionCheck[] = [];
    const approved = approvedPipelineDecision(decision);
    if (!approved) {
      checks.push(executionFail('invalid-decision', 'M6 decision is not fully approved'));
      return executionDecision(checks);
    }
    if (!isNonNegativeSafeInteger(now)) {
      checks.push(
        executionFail('invalid-decision', 'execution time must be explicit Unix seconds'),
      );
      return executionDecision(checks);
    }

    const session = this.#registeredSession.session;
    const request = approved.request;
    if (now >= session.expiry) {
      checks.push(executionFail('session-expired', 'Altana session has expired'));
      return executionDecision(checks);
    }
    if (request.chainId !== this.#chainId || !clientSupportsChain(this.#client, request.chainId)) {
      checks.push(
        executionFail(
          'session-chain-mismatch',
          'request chain is not configured for this Altana executor',
        ),
      );
      return executionDecision(checks);
    }
    if (!sameAddress(request.sender, session.walletAddress)) {
      checks.push(
        executionFail('session-wallet-mismatch', 'request sender is not the Altana session wallet'),
      );
      return executionDecision(checks);
    }
    if (!sessionAllowsCall(session, request)) {
      checks.push(
        executionFail(
          'session-call-not-allowed',
          'session permissions do not allow the target and selector',
        ),
      );
      return executionDecision(checks);
    }
    if (!sessionAllowsSpend(session, request, approved.intent.tokenTransfers)) {
      checks.push(
        executionFail(
          'session-spend-not-allowed',
          'session spend permissions do not cover this request',
        ),
      );
      return executionDecision(checks);
    }

    let result: unknown;
    try {
      result = await this.#client.execute({
        session,
        chainId: request.chainId,
        calls: [{ to: request.target, value: request.nativeValue, data: request.data }],
      });
    } catch {
      checks.push(executionFail('relay-unavailable', 'Altana relay execution failed'));
      return executionDecision(checks);
    }

    const relay = analyzeRelayResult(result);
    if (relay.kind === 'failed') {
      checks.push(executionFail('relay-failed', 'Altana relay reported FAILED'));
      return executionDecision(checks);
    }
    if (relay.kind === 'invalid') {
      checks.push(executionFail('invalid-relay-result', relay.detail));
      return executionDecision(checks);
    }
    return executionDecision(checks, relay.submission);
  }
}

function validateAdminOptions(options: AltanaAdminAdapterOptions): string[] {
  const errors: string[] = [];
  if (!isPositiveSafeInteger(options.chainId))
    errors.push('chainId must be a positive safe integer');
  if (!clientSupportsChain(options.client, options.chainId))
    errors.push('client must support chainId');
  if (!isRecord(options.wallet) || !isNonZeroAddress(options.wallet.address)) {
    errors.push('wallet must contain a non-zero address');
  }
  if (!isSigner(options.signer)) errors.push('signer is invalid');
  return errors;
}

function validateSessionExecutorOptions(options: AltanaSessionExecutorOptions): string[] {
  const errors: string[] = [];
  if (!isPositiveSafeInteger(options.chainId))
    errors.push('chainId must be a positive safe integer');
  if (!clientSupportsChain(options.client, options.chainId))
    errors.push('client must support chainId');
  if (!isRegisteredSession(options.registeredSession)) errors.push('registeredSession is invalid');
  return errors;
}

function validateGrant(input: AltanaRegisteredSessionGrant): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ['grant must be an object'];
  if (!isNonNegativeSafeInteger(input.now)) errors.push('now must be a non-negative safe integer');
  if (!isPositiveSafeInteger(input.expiry)) errors.push('expiry must be a positive safe integer');
  if (
    isNonNegativeSafeInteger(input.now) &&
    isPositiveSafeInteger(input.expiry) &&
    input.expiry <= input.now
  ) {
    errors.push('expiry must be in the future');
  }
  errors.push(...validatePermissions(input.permissions));
  if (input.sessionSigner !== undefined && !isSigner(input.sessionSigner)) {
    errors.push('sessionSigner is invalid');
  }
  if (input.feeToken !== undefined && !isNonZeroAddress(input.feeToken)) {
    errors.push('feeToken must be a non-zero address');
  }
  return errors;
}

function validatePermissions(permissions: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(permissions)) return ['permissions must be an object'];
  if (!Array.isArray(permissions.calls) || permissions.calls.length === 0) {
    errors.push('permissions.calls must contain at least one bounded rule');
  } else {
    for (const permission of permissions.calls) {
      if (!isCallPermission(permission)) errors.push('call permission is invalid');
    }
  }
  if (!Array.isArray(permissions.spend) || permissions.spend.length === 0) {
    errors.push('permissions.spend must contain at least one bounded cap');
  } else {
    for (const permission of permissions.spend) {
      if (!isSpendPermission(permission)) errors.push('spend permission is invalid');
    }
    if (
      !permissions.spend.some(
        (permission) => isSpendPermission(permission) && permission.token === undefined,
      )
    ) {
      errors.push('permissions.spend must include a native gas allowance');
    }
  }
  return errors;
}

function approvedPipelineDecision(value: unknown):
  | (ExecutionPipelineDecision & {
      request: RawExecutionRequest;
      intent: ExecutionIntent;
    })
  | undefined {
  if (!isRecord(value) || value.approved !== true) return undefined;
  const decision = value as unknown as ExecutionPipelineDecision;
  if (!Array.isArray(decision.rejectionReasons) || decision.rejectionReasons.length !== 0) {
    return undefined;
  }
  if (!decision.policyDecision?.approved || !decision.simulation?.success) return undefined;
  if (!decision.request || !decision.intent) return undefined;
  if (!validateRawExecutionRequest(decision.request).valid) return undefined;
  if (!validateExecutionIntent(decision.intent).valid) return undefined;
  if (!requestMatchesIntent(decision.request, decision.intent)) return undefined;
  if (
    typeof decision.simulation.blockNumber !== 'bigint' ||
    decision.simulation.blockNumber < 0n ||
    typeof decision.simulation.gasUsed !== 'bigint' ||
    decision.simulation.gasUsed < 0n ||
    !isHexBytes(decision.simulation.returnData)
  ) {
    return undefined;
  }
  return decision as ExecutionPipelineDecision & {
    request: RawExecutionRequest;
    intent: ExecutionIntent;
  };
}

function requestMatchesIntent(request: RawExecutionRequest, intent: ExecutionIntent): boolean {
  return (
    request.chainId === intent.chainId &&
    request.agentId === intent.agentId &&
    sameAddress(request.principal, intent.principal) &&
    sameAddress(request.target, intent.target) &&
    request.data.slice(0, 10).toLowerCase() === intent.selector.toLowerCase() &&
    request.nativeValue === intent.nativeValue &&
    request.protocol === intent.protocol &&
    request.slippageBps === intent.slippageBps &&
    request.requestedAt === intent.requestedAt
  );
}

function sessionAllowsCall(session: Session, request: RawExecutionRequest): boolean {
  const calls = session.permissions.calls;
  if (!Array.isArray(calls) || calls.length === 0) return false;
  const selector = request.data.slice(0, 10).toLowerCase();
  return calls.some((permission) => {
    if (!isCallPermission(permission)) return false;
    const target = 'to' in permission ? permission.to : undefined;
    const signature = 'signature' in permission ? permission.signature : undefined;
    if (target !== undefined && !sameAddress(target, request.target)) return false;
    if (signature !== undefined) {
      const permissionSelector = selectorForPermission(signature);
      if (permissionSelector === undefined || permissionSelector.toLowerCase() !== selector)
        return false;
    }
    return true;
  });
}

function sessionAllowsSpend(
  session: Session,
  request: RawExecutionRequest,
  tokenTransfers: readonly TokenTransferIntent[],
): boolean {
  const spend = session.permissions.spend;
  if (!Array.isArray(spend) || spend.length === 0) return false;
  const nativeCaps = spend.filter(
    (permission): permission is SpendPermission =>
      isSpendPermission(permission) && permission.token === undefined,
  );
  if (
    !nativeCaps.some(
      (permission) => permission.limit > 0n && request.nativeValue <= permission.limit,
    )
  ) {
    return false;
  }
  const aggregated = aggregateTokenTransfers(tokenTransfers);
  for (const transfer of aggregated.values()) {
    const allowed = spend.some(
      (permission) =>
        isSpendPermission(permission) &&
        permission.token !== undefined &&
        sameAddress(permission.token, transfer.token) &&
        transfer.amount <= permission.limit,
    );
    if (!allowed) return false;
  }
  return true;
}

function aggregateTokenTransfers(
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

function selectorForPermission(signature: string): Hex | undefined {
  if (/^0x[0-9a-fA-F]{8}$/u.test(signature)) return signature as Hex;
  try {
    return toFunctionSelector(signature);
  } catch {
    return undefined;
  }
}

function permissionsEqual(left: SessionPermissions, right: SessionPermissions): boolean {
  const leftCalls = left.calls ?? [];
  const rightCalls = right.calls ?? [];
  const leftSpend = left.spend ?? [];
  const rightSpend = right.spend ?? [];
  if (leftCalls.length !== rightCalls.length || leftSpend.length !== rightSpend.length)
    return false;
  return (
    leftCalls.every((permission, index) => callPermissionEqual(permission, rightCalls[index])) &&
    leftSpend.every((permission, index) => spendPermissionEqual(permission, rightSpend[index]))
  );
}

function callPermissionEqual(left: CallPermission, right: CallPermission | undefined): boolean {
  if (!right) return false;
  const leftTo = 'to' in left ? left.to : undefined;
  const rightTo = 'to' in right ? right.to : undefined;
  const leftSignature = 'signature' in left ? left.signature : undefined;
  const rightSignature = 'signature' in right ? right.signature : undefined;
  return (
    (leftTo === undefined
      ? rightTo === undefined
      : rightTo !== undefined && sameAddress(leftTo, rightTo)) && leftSignature === rightSignature
  );
}

function spendPermissionEqual(left: SpendPermission, right: SpendPermission | undefined): boolean {
  if (!right) return false;
  return (
    left.limit === right.limit &&
    left.period === right.period &&
    (left.token === undefined
      ? right.token === undefined
      : right.token !== undefined && sameAddress(left.token, right.token))
  );
}

function isCallPermission(value: unknown): value is CallPermission {
  if (!isRecord(value)) return false;
  const hasTo = value.to !== undefined;
  const hasSignature = value.signature !== undefined;
  if (!hasTo && !hasSignature) return false;
  if (hasTo && !isNonZeroAddress(value.to)) return false;
  if (
    hasSignature &&
    (typeof value.signature !== 'string' || selectorForPermission(value.signature) === undefined)
  ) {
    return false;
  }
  return true;
}

function isSpendPermission(value: unknown): value is SpendPermission {
  return (
    isRecord(value) &&
    typeof value.limit === 'bigint' &&
    value.limit > 0n &&
    isSpendPeriod(value.period) &&
    (value.token === undefined || isNonZeroAddress(value.token))
  );
}

function isSpendPeriod(value: unknown): value is SpendPermission['period'] {
  return (
    value === 'minute' ||
    value === 'hour' ||
    value === 'day' ||
    value === 'week' ||
    value === 'month' ||
    value === 'year'
  );
}

function isSigner(value: unknown): value is Signer {
  return (
    isRecord(value) &&
    (value.type === 'privateKey' || value.type === 'injected' || value.type === 'passkey') &&
    isNonZeroAddress(value.address) &&
    isNonEmptyHex(value.publicKey) &&
    typeof value.signDigest === 'function'
  );
}

function isAltanaSession(value: unknown): value is Session {
  return (
    isRecord(value) &&
    isNonZeroAddress(value.walletAddress) &&
    isSigner(value.signer) &&
    isNonEmptyHex(value.publicKey) &&
    isPositiveSafeInteger(value.expiry) &&
    validatePermissions(value.permissions).length === 0
  );
}

function isRegisteredSession(value: unknown): value is RegisteredAltanaSession {
  return (
    isRecord(value) &&
    value.registration === 'registered' &&
    isNonNegativeSafeInteger(value.grantedAt) &&
    isAltanaSession(value.session)
  );
}

function clientSupportsChain(client: unknown, chainId: number): client is AltanaClient {
  return (
    isRecord(client) &&
    Array.isArray(client.chains) &&
    client.chains.some((chain) => isRecord(chain) && chain.chainId === chainId) &&
    typeof client.execute === 'function' &&
    typeof client.grantSession === 'function' &&
    typeof client.revokeSession === 'function'
  );
}

function requireRelaySubmission(result: unknown, operation: string): AltanaRelaySubmission {
  const relay = analyzeRelayResult(result);
  if (relay.kind === 'failed') {
    throw new AltanaIntegrationError(
      'relay-failed',
      `Altana relay reported FAILED for ${operation}`,
    );
  }
  if (relay.kind === 'invalid') {
    throw new AltanaIntegrationError('invalid-relay-result', relay.detail);
  }
  return relay.submission;
}

function analyzeRelayResult(
  result: unknown,
):
  | { kind: 'ok'; submission: AltanaRelaySubmission }
  | { kind: 'failed' }
  | { kind: 'invalid'; detail: string } {
  if (!isRecord(result)) return { kind: 'invalid', detail: 'relay result must be an object' };
  if (!isNonEmptyHex(result.callsId))
    return { kind: 'invalid', detail: 'relay callsId must be hex' };
  if (result.status === 'FAILED') return { kind: 'failed' };
  if (result.status !== 'PENDING' && result.status !== 'CONFIRMED') {
    return { kind: 'invalid', detail: 'relay status is invalid' };
  }
  if (!isNonEmptyHex(result.transactionHash)) {
    return { kind: 'invalid', detail: 'relay result must include a transactionHash' };
  }
  return {
    kind: 'ok',
    submission: {
      callsId: result.callsId,
      transactionHash: result.transactionHash,
      status: result.status,
    },
  };
}

function executionDecision(
  checks: readonly AltanaExecutionCheck[],
  submission?: AltanaRelaySubmission,
): AltanaExecutionDecision {
  const rejectionReasons = checks.filter((check) => !check.passed).map((check) => check.code);
  return {
    submitted: rejectionReasons.length === 0 && submission !== undefined,
    checks,
    rejectionReasons: [...new Set(rejectionReasons)],
    ...(submission
      ? {
          callsId: submission.callsId,
          transactionHash: submission.transactionHash,
          relayStatus: submission.status,
        }
      : {}),
  };
}

function executionFail(code: AltanaExecutionCheckCode, detail: string): AltanaExecutionCheck {
  return { code, passed: false, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNonZeroAddress(value: unknown): value is Address {
  return typeof value === 'string' && isAddress(value) && !/^0x0{40}$/u.test(value);
}

function isHexBytes(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/u.test(value);
}

function isNonEmptyHex(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/u.test(value);
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export type {
  CallPermission as AltanaCallPermission,
  ExecuteResult as AltanaExecuteResult,
  Session as AltanaSession,
  SessionPermissions as AltanaSessionPermissions,
  Signer as AltanaSigner,
  SpendPermission as AltanaSpendPermission,
  Wallet as AltanaWallet,
};
