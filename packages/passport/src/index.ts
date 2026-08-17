import type { AltanaExecutionDecision } from '@ambit/altana';
import {
  validateExecutionIntent,
  validateRawExecutionRequest,
  type ExecutionIntent,
  type ExecutionPipelineDecision,
  type RawExecutionRequest,
  type SimulationEvidence,
  type TokenTransferIntent,
} from '@ambit/execution';
import { encodePacked, isAddress, keccak256, type Address, type Hex } from 'viem';

export const EXECUTION_PASSPORT_VERSION = 'v0.1.0' as const;

export type ExecutionPassportOutcome = 'succeeded' | 'reverted';

export interface ReceiptTransaction {
  hash: Hex;
  chainId: number;
  from: Address;
  to: Address | null;
  input: Hex;
  value: bigint;
  blockNumber: bigint | null;
  blockHash: Hex | null;
}

export interface ReceiptRecord {
  transactionHash: Hex;
  from: Address;
  to: Address | null;
  status: 'success' | 'reverted';
  blockNumber: bigint;
  blockHash: Hex;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
}

export interface ReceiptBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}

export interface ExecutionReceiptClient {
  readonly chainId: number;
  getTransaction(args: { hash: Hex }): Promise<unknown>;
  getTransactionReceipt(args: { hash: Hex }): Promise<unknown>;
  getBlock(args: { blockHash: Hex }): Promise<unknown>;
  getBlockNumber(): Promise<unknown>;
}

export interface ViemReceiptClient {
  readonly chain?: { readonly id?: number };
  getTransaction(args: { hash: Hex }): Promise<unknown>;
  getTransactionReceipt(args: { hash: Hex }): Promise<unknown>;
  getBlock(args: { blockHash: Hex }): Promise<unknown>;
  getBlockNumber(): Promise<unknown>;
}

export interface ExecutionPassport {
  version: typeof EXECUTION_PASSPORT_VERSION;
  id: Hex;
  chainId: number;
  agentId: string;
  principal: Address;
  sender: Address;
  target: Address;
  calldata: Hex;
  selector: Hex;
  nativeValue: bigint;
  tokenTransfers: readonly TokenTransferIntent[];
  protocol?: string;
  requestedAt: number;
  policyVersion: string;
  decoderId: string;
  simulation: {
    blockNumber: bigint;
    gasUsed: bigint;
    returnData: Hex;
  };
  altana: {
    callsId: Hex;
    relayStatus: 'PENDING' | 'CONFIRMED';
    transactionHash: Hex;
  };
  receipt: {
    outcome: ExecutionPassportOutcome;
    blockNumber: bigint;
    blockHash: Hex;
    blockTimestamp: bigint;
    gasUsed: bigint;
    effectiveGasPrice: bigint;
    confirmations: bigint;
  };
  verifiedAt: number;
}

export interface ExecutionPassportStoreResult {
  status: 'created' | 'existing';
  passport: unknown;
}

export interface ExecutionPassportStore {
  record(passport: ExecutionPassport): Promise<unknown>;
}

export type ExecutionPassportCheckCode =
  | 'invalid-context'
  | 'invalid-pipeline-decision'
  | 'invalid-altana-decision'
  | 'chain-unavailable'
  | 'transaction-mismatch'
  | 'receipt-mismatch'
  | 'block-mismatch'
  | 'insufficient-confirmations'
  | 'persistence-failed'
  | 'persistence-conflict';

export interface ExecutionPassportCheck {
  code: ExecutionPassportCheckCode;
  passed: boolean;
  detail: string;
}

export interface ExecutionPassportDecision {
  recorded: boolean;
  successful: boolean;
  checks: readonly ExecutionPassportCheck[];
  rejectionReasons: readonly ExecutionPassportCheckCode[];
  passport?: ExecutionPassport;
}

export interface VerifyAndRecordExecutionPassportInput {
  pipelineDecision: unknown;
  altanaDecision: unknown;
  client: unknown;
  store: unknown;
  requiredConfirmations: unknown;
  verifiedAt: unknown;
}

export function createViemExecutionReceiptClient(client: unknown): ExecutionReceiptClient {
  if (!isViemReceiptClient(client) || !isPositiveSafeInteger(client.chain?.id)) {
    throw new Error('viem client must expose a configured positive chain ID and receipt methods');
  }

  return {
    chainId: client.chain.id,
    getTransaction: (args) => client.getTransaction(args),
    getTransactionReceipt: (args) => client.getTransactionReceipt(args),
    getBlock: (args) => client.getBlock(args),
    getBlockNumber: () => client.getBlockNumber(),
  };
}

export async function verifyAndRecordExecutionPassport(
  input: VerifyAndRecordExecutionPassportInput,
): Promise<ExecutionPassportDecision> {
  const checks: ExecutionPassportCheck[] = [];
  if (!isRecord(input) || !isPositiveSafeInteger(input.requiredConfirmations)) {
    return passportFailure(checks, 'invalid-context', 'requiredConfirmations must be positive');
  }
  if (!isNonNegativeSafeInteger(input.verifiedAt)) {
    return passportFailure(checks, 'invalid-context', 'verifiedAt must be a Unix-second timestamp');
  }
  if (!isReceiptClient(input.client) || !isPassportStore(input.store)) {
    return passportFailure(
      checks,
      'invalid-context',
      'client and store must expose receipt methods',
    );
  }

  const pipeline = parsePipelineDecision(input.pipelineDecision);
  if (!pipeline) {
    return passportFailure(
      checks,
      'invalid-pipeline-decision',
      'passport requires an approved, successful M6 pipeline decision',
    );
  }
  if (input.verifiedAt < pipeline.request.requestedAt) {
    return passportFailure(
      checks,
      'invalid-context',
      'verifiedAt must not precede the approved request timestamp',
    );
  }
  checks.push({
    code: 'invalid-pipeline-decision',
    passed: true,
    detail: 'approved M6 request, intent, policy, and simulation are present',
  });

  const altana = parseAltanaDecision(input.altanaDecision);
  if (!altana) {
    return passportFailure(
      checks,
      'invalid-altana-decision',
      'passport requires a submitted M7 Altana relay decision',
    );
  }
  checks.push({
    code: 'invalid-altana-decision',
    passed: true,
    detail: 'Altana relay submission contains a valid transaction hash',
  });

  if (input.client.chainId !== pipeline.request.chainId) {
    return passportFailure(
      checks,
      'invalid-context',
      'receipt client chain does not match the approved request chain',
    );
  }

  let transaction: ReceiptTransaction;
  let receipt: ReceiptRecord;
  let latestBlock: bigint;
  try {
    const [observedTransaction, observedReceipt, observedLatestBlock] = await Promise.all([
      input.client.getTransaction({ hash: altana.transactionHash }),
      input.client.getTransactionReceipt({ hash: altana.transactionHash }),
      input.client.getBlockNumber(),
    ]);
    transaction = parseReceiptTransaction(observedTransaction);
    receipt = parseReceiptRecord(observedReceipt);
    latestBlock = parseBlockNumber(observedLatestBlock);
  } catch {
    return passportFailure(
      checks,
      'chain-unavailable',
      'transaction, receipt, or current block could not be read from the configured chain',
    );
  }

  if (!transactionMatchesRequest(transaction, altana.transactionHash, pipeline.request)) {
    return passportFailure(
      checks,
      'transaction-mismatch',
      'mined transaction does not exactly match the approved request',
    );
  }
  checks.push({
    code: 'transaction-mismatch',
    passed: true,
    detail: 'transaction hash, chain, sender, target, calldata, and value match M6',
  });

  if (!receiptMatchesTransaction(receipt, transaction, pipeline.request)) {
    return passportFailure(
      checks,
      'receipt-mismatch',
      'receipt does not match the mined transaction and approved request',
    );
  }
  checks.push({
    code: 'receipt-mismatch',
    passed: true,
    detail: 'receipt hash, sender, target, and mined block match the transaction',
  });

  let block: ReceiptBlock;
  try {
    block = parseReceiptBlock(await input.client.getBlock({ blockHash: receipt.blockHash }));
  } catch {
    return passportFailure(
      checks,
      'chain-unavailable',
      'receipt block could not be read from the configured chain',
    );
  }

  if (block.number !== receipt.blockNumber || !sameHex(block.hash, receipt.blockHash)) {
    return passportFailure(
      checks,
      'block-mismatch',
      'receipt block is not canonical for the receipt block hash and number',
    );
  }
  checks.push({
    code: 'block-mismatch',
    passed: true,
    detail: 'receipt block hash and number resolve to the same canonical block',
  });

  const confirmations = latestBlock - receipt.blockNumber + 1n;
  if (confirmations < BigInt(input.requiredConfirmations)) {
    return passportFailure(
      checks,
      'insufficient-confirmations',
      `receipt has ${confirmations.toString()} confirmations; ${input.requiredConfirmations} required`,
    );
  }
  checks.push({
    code: 'insufficient-confirmations',
    passed: true,
    detail: `receipt has ${confirmations.toString()} required confirmations`,
  });

  const passport = createExecutionPassport({
    pipeline,
    altana,
    receipt,
    block,
    confirmations,
    verifiedAt: input.verifiedAt,
  });

  let persistence: ExecutionPassportStoreResult | undefined;
  try {
    persistence = parseStoreResult(await input.store.record(passport));
  } catch {
    return passportFailure(
      checks,
      'persistence-failed',
      'passport store failed to record evidence',
    );
  }
  if (!persistence || !samePassport(persistence.passport, passport)) {
    return passportFailure(
      checks,
      'persistence-conflict',
      'passport store returned evidence that differs from the verified passport',
    );
  }
  checks.push({
    code: 'persistence-failed',
    passed: true,
    detail: `${persistence.status} immutable execution passport`,
  });

  return {
    recorded: true,
    successful: passport.receipt.outcome === 'succeeded',
    checks,
    rejectionReasons: [],
    passport,
  };
}

interface ParsedPipeline {
  request: RawExecutionRequest;
  intent: ExecutionIntent;
  policyVersion: string;
  decoderId: string;
  simulation: SimulationEvidence;
}

interface ParsedAltana {
  callsId: Hex;
  relayStatus: 'PENDING' | 'CONFIRMED';
  transactionHash: Hex;
}

function parsePipelineDecision(value: unknown): ParsedPipeline | undefined {
  if (!isRecord(value) || value.approved !== true || !isRecord(value.policyDecision))
    return undefined;
  if (
    value.policyDecision.approved !== true ||
    !isNonEmptyString(value.policyDecision.policyVersion)
  ) {
    return undefined;
  }
  if (!isNonEmptyString(value.decoderId)) return undefined;
  if (validateRawExecutionRequest(value.request).valid !== true) return undefined;
  if (validateExecutionIntent(value.intent).valid !== true) return undefined;
  const request = value.request as RawExecutionRequest;
  const intent = value.intent as ExecutionIntent;
  if (!requestMatchesIntent(request, intent)) return undefined;
  if (!isSimulationEvidence(value.simulation) || value.simulation.success !== true)
    return undefined;
  if (value.simulation.blockNumber < 0n || value.simulation.gasUsed < 0n) return undefined;
  if (Array.isArray(value.rejectionReasons) && value.rejectionReasons.length > 0) return undefined;

  return {
    request,
    intent,
    policyVersion: value.policyDecision.policyVersion,
    decoderId: value.decoderId,
    simulation: value.simulation,
  };
}

function parseAltanaDecision(value: unknown): ParsedAltana | undefined {
  if (!isRecord(value) || value.submitted !== true) return undefined;
  if (!isNonEmptyHex(value.callsId) || !isTransactionHash(value.transactionHash)) return undefined;
  if (value.relayStatus !== 'PENDING' && value.relayStatus !== 'CONFIRMED') return undefined;
  if (Array.isArray(value.rejectionReasons) && value.rejectionReasons.length > 0) return undefined;

  return {
    callsId: value.callsId,
    relayStatus: value.relayStatus,
    transactionHash: value.transactionHash,
  };
}

function parseReceiptTransaction(value: unknown): ReceiptTransaction {
  if (!isRecord(value)) throw new Error('transaction must be an object');
  if (
    !isTransactionHash(value.hash) ||
    !isPositiveSafeInteger(value.chainId) ||
    !isNonZeroAddress(value.from) ||
    !(value.to === null || isNonZeroAddress(value.to)) ||
    !isHexBytes(value.input) ||
    typeof value.value !== 'bigint' ||
    value.value < 0n ||
    !(value.blockNumber === null || isNonNegativeBigInt(value.blockNumber)) ||
    !(value.blockHash === null || isTransactionHash(value.blockHash))
  ) {
    throw new Error('transaction is malformed');
  }
  return value as unknown as ReceiptTransaction;
}

function parseReceiptRecord(value: unknown): ReceiptRecord {
  if (!isRecord(value)) throw new Error('receipt must be an object');
  if (
    !isTransactionHash(value.transactionHash) ||
    !isNonZeroAddress(value.from) ||
    !(value.to === null || isNonZeroAddress(value.to)) ||
    (value.status !== 'success' && value.status !== 'reverted') ||
    !isNonNegativeBigInt(value.blockNumber) ||
    !isTransactionHash(value.blockHash) ||
    !isNonNegativeBigInt(value.gasUsed) ||
    !isNonNegativeBigInt(value.effectiveGasPrice)
  ) {
    throw new Error('receipt is malformed');
  }
  return value as unknown as ReceiptRecord;
}

function parseReceiptBlock(value: unknown): ReceiptBlock {
  if (
    !isRecord(value) ||
    !isNonNegativeBigInt(value.number) ||
    !isTransactionHash(value.hash) ||
    !isNonNegativeBigInt(value.timestamp)
  ) {
    throw new Error('block is malformed');
  }
  return value as unknown as ReceiptBlock;
}

function parseBlockNumber(value: unknown): bigint {
  if (!isNonNegativeBigInt(value)) throw new Error('block number is malformed');
  return value;
}

function parseStoreResult(value: unknown): ExecutionPassportStoreResult | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status !== 'created' && value.status !== 'existing') return undefined;
  return { status: value.status, passport: value.passport };
}

function createExecutionPassport(input: {
  pipeline: ParsedPipeline;
  altana: ParsedAltana;
  receipt: ReceiptRecord;
  block: ReceiptBlock;
  confirmations: bigint;
  verifiedAt: number;
}): ExecutionPassport {
  const { request, intent, policyVersion, decoderId, simulation } = input.pipeline;
  return {
    version: EXECUTION_PASSPORT_VERSION,
    id: executionPassportId(request.chainId, input.altana.transactionHash),
    chainId: request.chainId,
    agentId: request.agentId,
    principal: request.principal,
    sender: request.sender,
    target: request.target,
    calldata: request.data,
    selector: intent.selector,
    nativeValue: request.nativeValue,
    tokenTransfers: intent.tokenTransfers.map((transfer) => ({ ...transfer })),
    ...(request.protocol ? { protocol: request.protocol } : {}),
    requestedAt: request.requestedAt,
    policyVersion,
    decoderId,
    simulation: {
      blockNumber: simulation.blockNumber,
      gasUsed: simulation.gasUsed,
      returnData: simulation.returnData,
    },
    altana: input.altana,
    receipt: {
      outcome: input.receipt.status === 'success' ? 'succeeded' : 'reverted',
      blockNumber: input.receipt.blockNumber,
      blockHash: input.receipt.blockHash,
      blockTimestamp: input.block.timestamp,
      gasUsed: input.receipt.gasUsed,
      effectiveGasPrice: input.receipt.effectiveGasPrice,
      confirmations: input.confirmations,
    },
    verifiedAt: input.verifiedAt,
  };
}

function executionPassportId(chainId: number, transactionHash: Hex): Hex {
  return keccak256(
    encodePacked(
      ['string', 'uint256', 'bytes32'],
      [EXECUTION_PASSPORT_VERSION, BigInt(chainId), transactionHash],
    ),
  );
}

function transactionMatchesRequest(
  transaction: ReceiptTransaction,
  transactionHash: Hex,
  request: RawExecutionRequest,
): boolean {
  return (
    sameHex(transaction.hash, transactionHash) &&
    transaction.chainId === request.chainId &&
    sameAddress(transaction.from, request.sender) &&
    transaction.to !== null &&
    sameAddress(transaction.to, request.target) &&
    sameHex(transaction.input, request.data) &&
    transaction.value === request.nativeValue &&
    transaction.blockNumber !== null &&
    transaction.blockHash !== null
  );
}

function receiptMatchesTransaction(
  receipt: ReceiptRecord,
  transaction: ReceiptTransaction,
  request: RawExecutionRequest,
): boolean {
  return (
    sameHex(receipt.transactionHash, transaction.hash) &&
    sameAddress(receipt.from, request.sender) &&
    receipt.to !== null &&
    sameAddress(receipt.to, request.target) &&
    transaction.blockNumber !== null &&
    transaction.blockHash !== null &&
    receipt.blockNumber === transaction.blockNumber &&
    sameHex(receipt.blockHash, transaction.blockHash)
  );
}

function requestMatchesIntent(request: RawExecutionRequest, intent: ExecutionIntent): boolean {
  return (
    request.chainId === intent.chainId &&
    request.agentId === intent.agentId &&
    sameAddress(request.principal, intent.principal) &&
    sameAddress(request.target, intent.target) &&
    sameHex(request.data.slice(0, 10) as Hex, intent.selector) &&
    request.nativeValue === intent.nativeValue &&
    request.protocol === intent.protocol &&
    request.slippageBps === intent.slippageBps &&
    request.requestedAt === intent.requestedAt
  );
}

function isSimulationEvidence(value: unknown): value is SimulationEvidence {
  return (
    isRecord(value) &&
    typeof value.success === 'boolean' &&
    isNonNegativeBigInt(value.blockNumber) &&
    isNonNegativeBigInt(value.gasUsed) &&
    isHexBytes(value.returnData) &&
    (value.revertReason === undefined || typeof value.revertReason === 'string')
  );
}

function samePassport(value: unknown, expected: ExecutionPassport): boolean {
  return isExecutionPassport(value) && passportFingerprint(value) === passportFingerprint(expected);
}

function isExecutionPassport(value: unknown): value is ExecutionPassport {
  if (!isRecord(value) || value.version !== EXECUTION_PASSPORT_VERSION) return false;
  if (
    !isTransactionHash(value.id) ||
    !isPositiveSafeInteger(value.chainId) ||
    !isNonEmptyDecimalId(value.agentId) ||
    !isNonZeroAddress(value.principal) ||
    !isNonZeroAddress(value.sender) ||
    !isNonZeroAddress(value.target) ||
    !isHexBytes(value.calldata) ||
    !isSelector(value.selector) ||
    !isNonNegativeBigInt(value.nativeValue) ||
    !Array.isArray(value.tokenTransfers) ||
    !isNonNegativeSafeInteger(value.requestedAt) ||
    !isNonEmptyString(value.policyVersion) ||
    !isNonEmptyString(value.decoderId) ||
    !isRecord(value.simulation) ||
    !isRecord(value.altana) ||
    !isRecord(value.receipt) ||
    !isNonNegativeSafeInteger(value.verifiedAt)
  ) {
    return false;
  }
  return (
    value.tokenTransfers.every(isTokenTransfer) &&
    isNonNegativeBigInt(value.simulation.blockNumber) &&
    isNonNegativeBigInt(value.simulation.gasUsed) &&
    isHexBytes(value.simulation.returnData) &&
    isNonEmptyHex(value.altana.callsId) &&
    (value.altana.relayStatus === 'PENDING' || value.altana.relayStatus === 'CONFIRMED') &&
    isTransactionHash(value.altana.transactionHash) &&
    (value.receipt.outcome === 'succeeded' || value.receipt.outcome === 'reverted') &&
    isNonNegativeBigInt(value.receipt.blockNumber) &&
    isTransactionHash(value.receipt.blockHash) &&
    isNonNegativeBigInt(value.receipt.blockTimestamp) &&
    isNonNegativeBigInt(value.receipt.gasUsed) &&
    isNonNegativeBigInt(value.receipt.effectiveGasPrice) &&
    isNonNegativeBigInt(value.receipt.confirmations)
  );
}

function passportFingerprint(passport: ExecutionPassport): string {
  return JSON.stringify([
    passport.version,
    passport.id.toLowerCase(),
    passport.chainId,
    passport.agentId,
    passport.principal.toLowerCase(),
    passport.sender.toLowerCase(),
    passport.target.toLowerCase(),
    passport.calldata.toLowerCase(),
    passport.selector.toLowerCase(),
    passport.nativeValue.toString(),
    passport.tokenTransfers.map((transfer) => [
      transfer.token.toLowerCase(),
      transfer.amount.toString(),
    ]),
    passport.protocol ?? null,
    passport.requestedAt,
    passport.policyVersion,
    passport.decoderId,
    passport.simulation.blockNumber.toString(),
    passport.simulation.gasUsed.toString(),
    passport.simulation.returnData.toLowerCase(),
    passport.altana.callsId.toLowerCase(),
    passport.altana.relayStatus,
    passport.altana.transactionHash.toLowerCase(),
    passport.receipt.outcome,
    passport.receipt.blockNumber.toString(),
    passport.receipt.blockHash.toLowerCase(),
    passport.receipt.blockTimestamp.toString(),
    passport.receipt.gasUsed.toString(),
    passport.receipt.effectiveGasPrice.toString(),
    passport.receipt.confirmations.toString(),
    passport.verifiedAt,
  ]);
}

function passportFailure(
  checks: readonly ExecutionPassportCheck[],
  code: ExecutionPassportCheckCode,
  detail: string,
): ExecutionPassportDecision {
  const failedChecks = [...checks, { code, passed: false, detail }];
  return {
    recorded: false,
    successful: false,
    checks: failedChecks,
    rejectionReasons: [
      ...new Set(failedChecks.filter((check) => !check.passed).map((check) => check.code)),
    ],
  };
}

function isReceiptClient(value: unknown): value is ExecutionReceiptClient {
  return (
    isRecord(value) &&
    isPositiveSafeInteger(value.chainId) &&
    typeof value.getTransaction === 'function' &&
    typeof value.getTransactionReceipt === 'function' &&
    typeof value.getBlock === 'function' &&
    typeof value.getBlockNumber === 'function'
  );
}

function isViemReceiptClient(value: unknown): value is ViemReceiptClient {
  return (
    isRecord(value) &&
    typeof value.getTransaction === 'function' &&
    typeof value.getTransactionReceipt === 'function' &&
    typeof value.getBlock === 'function' &&
    typeof value.getBlockNumber === 'function'
  );
}

function isPassportStore(value: unknown): value is ExecutionPassportStore {
  return isRecord(value) && typeof value.record === 'function';
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

function isNonNegativeBigInt(value: unknown): value is bigint {
  return typeof value === 'bigint' && value >= 0n;
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

function isTransactionHash(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/u.test(value);
}

function isSelector(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{8}$/u.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyDecimalId(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/u.test(value);
}

function isTokenTransfer(value: unknown): value is TokenTransferIntent {
  return isRecord(value) && isNonZeroAddress(value.token) && isNonNegativeBigInt(value.amount);
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export type {
  AltanaExecutionDecision,
  ExecutionPipelineDecision,
  ExecutionIntent,
  RawExecutionRequest,
};
