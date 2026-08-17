import type { RawExecutionRequest, SupportedCallDecoder } from '@ambit/execution';
import { ChainId } from '@pancakeswap/chains';
import { Percent, TradeType } from '@pancakeswap/sdk';
import type { SmartRouterTrade } from '@pancakeswap/smart-router';
import type * as UniversalRouterSdk from '@pancakeswap/universal-router-sdk';
import { createRequire } from 'node:module';
import {
  decodeFunctionData,
  hexToBigInt,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';

export const PANCAKESWAP_INTEGRATION_VERSION = 'v1.0.0' as const;
export const PANCAKESWAP_SMART_ROUTER_VERSION = '7.6.1' as const;
export const PANCAKESWAP_UNIVERSAL_ROUTER_SDK_VERSION = '1.5.2' as const;
export const PANCAKESWAP_PROTOCOL = 'pancakeswap' as const;

export type PancakeSwapChainId = 56 | 97;
export type PancakeSwapExactInputCommand = 'V2_SWAP_EXACT_IN' | 'V3_SWAP_EXACT_IN';

export type PancakeSwapIntegrationErrorCode =
  | 'invalid-quote'
  | 'unsupported-chain'
  | 'invalid-router-call'
  | 'unsupported-command'
  | 'quote-mismatch'
  | 'expired-quote'
  | 'request-mismatch';

export class PancakeSwapIntegrationError extends Error {
  constructor(
    readonly code: PancakeSwapIntegrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PancakeSwapIntegrationError';
  }
}

export interface PancakeSwapExactInputBuildInput {
  trade: SmartRouterTrade<TradeType.EXACT_INPUT>;
  sender: Address;
  slippageBps: number;
  quotedAt: number;
  deadline: number;
}

export interface PancakeSwapExactInputQuoteInput {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  quotedAmountOut: bigint;
  slippageBps: number;
  recipient: Address;
  quoteBlockNumber: bigint;
  quotedAt: number;
  deadline: number;
  calldata: Hex;
  nativeValue: bigint;
}

export interface PancakeSwapExactInputPlan extends PancakeSwapExactInputQuoteInput {
  version: typeof PANCAKESWAP_INTEGRATION_VERSION;
  chainId: PancakeSwapChainId;
  router: Address;
  command: PancakeSwapExactInputCommand;
  minimumAmountOut: bigint;
}

interface DecodedSwapCommand {
  command: PancakeSwapExactInputCommand;
  recipient: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  tokenIn: Address;
  tokenOut: Address;
  payerIsUser: boolean;
}

const executeWithDeadlineAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);
const executeWithDeadlineSelector = toFunctionSelector('execute(bytes,bytes[],uint256)');
const nodeRequire = createRequire(import.meta.url);
const { getUniversalRouterAddress, PancakeSwapUniversalRouter } = nodeRequire(
  '@pancakeswap/universal-router-sdk',
) as typeof UniversalRouterSdk;

export function getPancakeSwapUniversalRouter(chainId: number): Address {
  if (chainId === ChainId.BSC) return getUniversalRouterAddress(ChainId.BSC);
  if (chainId === ChainId.BSC_TESTNET) {
    return getUniversalRouterAddress(ChainId.BSC_TESTNET);
  }
  throw new PancakeSwapIntegrationError(
    'unsupported-chain',
    'M12 supports only BSC mainnet and BSC testnet',
  );
}

export function buildPancakeSwapExactInputPlan(
  input: PancakeSwapExactInputBuildInput,
  now: number,
): PancakeSwapExactInputPlan {
  if (!input || typeof input !== 'object') {
    throw new PancakeSwapIntegrationError('invalid-quote', 'build input must be an object');
  }
  if (input.trade.tradeType !== TradeType.EXACT_INPUT) {
    throw new PancakeSwapIntegrationError('invalid-quote', 'trade must be exact input');
  }
  if (!isNonZeroAddress(input.sender)) {
    throw new PancakeSwapIntegrationError('invalid-quote', 'sender must be a non-zero address');
  }

  const inputCurrency = input.trade.inputAmount.currency;
  const outputCurrency = input.trade.outputAmount.currency;
  if (inputCurrency.isNative || outputCurrency.isNative) {
    throw new PancakeSwapIntegrationError(
      'unsupported-command',
      'M12 supports only ERC-20 input and output currencies',
    );
  }
  if (inputCurrency.chainId !== outputCurrency.chainId) {
    throw new PancakeSwapIntegrationError('invalid-quote', 'trade currencies must share a chain');
  }
  if (!isNonNegativeSafeInteger(input.trade.blockNumber)) {
    throw new PancakeSwapIntegrationError(
      'invalid-quote',
      'Smart Router trade must include an explicit quote block number',
    );
  }

  const method = PancakeSwapUniversalRouter.swapERC20CallParameters(input.trade, {
    recipient: input.sender,
    slippageTolerance: new Percent(input.slippageBps, 10_000),
    deadlineOrPreviousBlockhash: BigInt(input.deadline),
    payerIsUser: true,
  });

  return createPancakeSwapExactInputPlan(
    {
      chainId: inputCurrency.chainId,
      tokenIn: inputCurrency.wrapped.address,
      tokenOut: outputCurrency.wrapped.address,
      amountIn: input.trade.inputAmount.quotient,
      quotedAmountOut: input.trade.outputAmount.quotient,
      slippageBps: input.slippageBps,
      recipient: input.sender,
      quoteBlockNumber: BigInt(input.trade.blockNumber),
      quotedAt: input.quotedAt,
      deadline: input.deadline,
      calldata: method.calldata as Hex,
      nativeValue: hexToBigInt(method.value as Hex),
    },
    now,
  );
}

export function createPancakeSwapExactInputPlan(
  input: unknown,
  now: unknown,
): PancakeSwapExactInputPlan {
  if (!isRecord(input)) {
    throw new PancakeSwapIntegrationError('invalid-quote', 'quote input must be an object');
  }
  if (!isNonNegativeSafeInteger(now)) {
    throw new PancakeSwapIntegrationError('invalid-quote', 'validation time must be Unix seconds');
  }

  const chainId = requireSupportedChain(input.chainId);
  const tokenIn = requireNonZeroAddress(input.tokenIn, 'tokenIn');
  const tokenOut = requireNonZeroAddress(input.tokenOut, 'tokenOut');
  if (sameAddress(tokenIn, tokenOut)) {
    throw new PancakeSwapIntegrationError('invalid-quote', 'input and output tokens must differ');
  }
  const amountIn = requirePositiveBigint(input.amountIn, 'amountIn');
  const quotedAmountOut = requirePositiveBigint(input.quotedAmountOut, 'quotedAmountOut');
  const slippageBps = requireSlippageBps(input.slippageBps);
  const recipient = requireNonZeroAddress(input.recipient, 'recipient');
  const quoteBlockNumber = requireNonNegativeBigint(input.quoteBlockNumber, 'quoteBlockNumber');
  const quotedAt = requireUnixSeconds(input.quotedAt, 'quotedAt');
  const deadline = requireUnixSeconds(input.deadline, 'deadline');
  if (quotedAt > now) {
    throw new PancakeSwapIntegrationError(
      'invalid-quote',
      'quote timestamp cannot be in the future',
    );
  }
  if (deadline <= now || deadline <= quotedAt) {
    throw new PancakeSwapIntegrationError('expired-quote', 'quote deadline has expired');
  }
  if (!isCalldata(input.calldata)) {
    throw new PancakeSwapIntegrationError('invalid-router-call', 'calldata is invalid');
  }
  if (input.nativeValue !== 0n) {
    throw new PancakeSwapIntegrationError(
      'unsupported-command',
      'M12 ERC-20 swaps require zero native value',
    );
  }

  const calldata = input.calldata;
  const outer = decodeOuterCall(calldata);
  if (outer.deadline !== BigInt(deadline)) {
    throw new PancakeSwapIntegrationError(
      'quote-mismatch',
      'calldata deadline does not match quote evidence',
    );
  }
  const decoded = decodeSingleExactInputCommand(calldata);
  const minimumAmountOut = minimumOutput(quotedAmountOut, slippageBps);
  if (minimumAmountOut <= 0n) {
    throw new PancakeSwapIntegrationError('invalid-quote', 'minimum output must be positive');
  }

  if (!sameAddress(decoded.recipient, recipient)) {
    throw new PancakeSwapIntegrationError(
      'quote-mismatch',
      'swap recipient does not match quote evidence',
    );
  }
  if (!decoded.payerIsUser) {
    throw new PancakeSwapIntegrationError(
      'unsupported-command',
      'swap must pull input from the caller',
    );
  }
  if (decoded.amountIn !== amountIn || decoded.amountOutMin !== minimumAmountOut) {
    throw new PancakeSwapIntegrationError(
      'quote-mismatch',
      'swap amounts do not match quote evidence',
    );
  }
  if (!sameAddress(decoded.tokenIn, tokenIn) || !sameAddress(decoded.tokenOut, tokenOut)) {
    throw new PancakeSwapIntegrationError(
      'quote-mismatch',
      'swap path does not match quote evidence',
    );
  }

  return Object.freeze({
    version: PANCAKESWAP_INTEGRATION_VERSION,
    chainId,
    router: getPancakeSwapUniversalRouter(chainId),
    command: decoded.command,
    tokenIn,
    tokenOut,
    amountIn,
    quotedAmountOut,
    minimumAmountOut,
    slippageBps,
    recipient,
    quoteBlockNumber,
    quotedAt,
    deadline,
    calldata,
    nativeValue: 0n,
  });
}

export function createPancakeSwapExactInputDecoder(
  plan: PancakeSwapExactInputPlan,
): SupportedCallDecoder {
  const validatedPlan = createPancakeSwapExactInputPlan(plan, plan.quotedAt);
  return {
    id: `pancakeswap-exact-input:${validatedPlan.chainId}:${keccak256(validatedPlan.calldata)}`,
    chainId: validatedPlan.chainId,
    target: validatedPlan.router,
    selector: executeWithDeadlineSelector,
    protocol: PANCAKESWAP_PROTOCOL,
    decode(request) {
      validateRequestBinding(request, validatedPlan);
      return {
        tokenTransfers: [{ token: validatedPlan.tokenIn, amount: validatedPlan.amountIn }],
        slippageBps: validatedPlan.slippageBps,
      };
    },
  };
}

function validateRequestBinding(
  request: RawExecutionRequest,
  plan: PancakeSwapExactInputPlan,
): void {
  if (!sameHex(request.data, plan.calldata)) {
    throw new PancakeSwapIntegrationError(
      'request-mismatch',
      'execution calldata does not match the validated quote plan',
    );
  }
  if (request.nativeValue !== 0n) {
    throw new PancakeSwapIntegrationError(
      'request-mismatch',
      'execution native value must be zero',
    );
  }
  if (!sameAddress(request.sender, plan.recipient)) {
    throw new PancakeSwapIntegrationError(
      'request-mismatch',
      'swap output must return to the submitting Altana wallet',
    );
  }
  if (request.requestedAt < plan.quotedAt || request.requestedAt >= plan.deadline) {
    throw new PancakeSwapIntegrationError(
      'expired-quote',
      'execution request falls outside the quote validity window',
    );
  }
  if (request.slippageBps !== undefined && request.slippageBps !== plan.slippageBps) {
    throw new PancakeSwapIntegrationError(
      'request-mismatch',
      'request slippage does not match decoded quote evidence',
    );
  }
}

function decodeOuterCall(calldata: Hex): { deadline: bigint } {
  try {
    const decoded = decodeFunctionData({ abi: executeWithDeadlineAbi, data: calldata });
    return { deadline: decoded.args[2] };
  } catch {
    throw new PancakeSwapIntegrationError(
      'invalid-router-call',
      'Universal Router call must be execute(bytes,bytes[],uint256)',
    );
  }
}

function decodeSingleExactInputCommand(calldata: Hex): DecodedSwapCommand {
  let commands: ReturnType<typeof PancakeSwapUniversalRouter.decodeCallData>;
  try {
    commands = PancakeSwapUniversalRouter.decodeCallData(calldata);
  } catch {
    throw new PancakeSwapIntegrationError(
      'invalid-router-call',
      'official Universal Router decoder rejected calldata',
    );
  }
  if (commands.length !== 1) {
    throw new PancakeSwapIntegrationError(
      'unsupported-command',
      'M12 requires exactly one Universal Router command',
    );
  }

  const command = commands[0]!;
  if (command.command !== 'V2_SWAP_EXACT_IN' && command.command !== 'V3_SWAP_EXACT_IN') {
    throw new PancakeSwapIntegrationError(
      'unsupported-command',
      `unsupported Universal Router command: ${command.command}`,
    );
  }
  const recipient = requireDecodedAddress(command.args, 'recipient');
  const amountIn = requireDecodedPositiveBigint(command.args, 'amountIn');
  const amountOutMin = requireDecodedPositiveBigint(command.args, 'amountOutMin');
  const payerIsUser = requireDecodedBoolean(command.args, 'payerIsUser');
  const path = decodedArgument(command.args, 'path');
  const tokens = command.command === 'V2_SWAP_EXACT_IN' ? decodeV2Path(path) : decodeV3Path(path);

  return {
    command: command.command,
    recipient,
    amountIn,
    amountOutMin,
    tokenIn: tokens[0]!,
    tokenOut: tokens[tokens.length - 1]!,
    payerIsUser,
  };
}

function decodeV2Path(value: unknown): readonly Address[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new PancakeSwapIntegrationError('invalid-router-call', 'V2 path is invalid');
  }
  const tokens = value.map((token) => requireNonZeroAddress(token, 'V2 path token'));
  return tokens;
}

function decodeV3Path(value: unknown): readonly Address[] {
  if (typeof value !== 'string' || !isHex(value)) {
    throw new PancakeSwapIntegrationError('invalid-router-call', 'V3 path is invalid');
  }
  const byteLength = (value.length - 2) / 2;
  if (byteLength < 43 || (byteLength - 20) % 23 !== 0) {
    throw new PancakeSwapIntegrationError('invalid-router-call', 'V3 path length is invalid');
  }

  const tokens: Address[] = [];
  let offset = 2;
  tokens.push(requireNonZeroAddress(`0x${value.slice(offset, offset + 40)}`, 'V3 path token'));
  offset += 40;
  while (offset < value.length) {
    offset += 6;
    tokens.push(requireNonZeroAddress(`0x${value.slice(offset, offset + 40)}`, 'V3 path token'));
    offset += 40;
  }
  return tokens;
}

function decodedArgument(args: readonly { name: string; value: unknown }[], name: string): unknown {
  const argument = args.find((candidate) => candidate.name === name);
  if (!argument) {
    throw new PancakeSwapIntegrationError(
      'invalid-router-call',
      `decoded command is missing ${name}`,
    );
  }
  return argument.value;
}

function requireDecodedAddress(
  args: readonly { name: string; value: unknown }[],
  name: string,
): Address {
  return requireNonZeroAddress(decodedArgument(args, name), name);
}

function requireDecodedPositiveBigint(
  args: readonly { name: string; value: unknown }[],
  name: string,
): bigint {
  return requirePositiveBigint(decodedArgument(args, name), name);
}

function requireDecodedBoolean(
  args: readonly { name: string; value: unknown }[],
  name: string,
): boolean {
  const value = decodedArgument(args, name);
  if (typeof value !== 'boolean') {
    throw new PancakeSwapIntegrationError('invalid-router-call', `${name} must be boolean`);
  }
  return value;
}

function minimumOutput(quotedAmountOut: bigint, slippageBps: number): bigint {
  return (quotedAmountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

function requireSupportedChain(value: unknown): PancakeSwapChainId {
  if (value !== ChainId.BSC && value !== ChainId.BSC_TESTNET) {
    throw new PancakeSwapIntegrationError(
      'unsupported-chain',
      'M12 supports only BSC mainnet and BSC testnet',
    );
  }
  return value;
}

function requireNonZeroAddress(value: unknown, field: string): Address {
  if (!isNonZeroAddress(value)) {
    throw new PancakeSwapIntegrationError('invalid-quote', `${field} must be a non-zero address`);
  }
  return value;
}

function requirePositiveBigint(value: unknown, field: string): bigint {
  if (typeof value !== 'bigint' || value <= 0n) {
    throw new PancakeSwapIntegrationError('invalid-quote', `${field} must be positive bigint`);
  }
  return value;
}

function requireNonNegativeBigint(value: unknown, field: string): bigint {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new PancakeSwapIntegrationError('invalid-quote', `${field} must be non-negative bigint`);
  }
  return value;
}

function requireSlippageBps(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= 10_000) {
    throw new PancakeSwapIntegrationError(
      'invalid-quote',
      'slippageBps must be an integer between 0 and 9999',
    );
  }
  return value as number;
}

function requireUnixSeconds(value: unknown, field: string): number {
  if (!isNonNegativeSafeInteger(value)) {
    throw new PancakeSwapIntegrationError(
      'invalid-quote',
      `${field} must be non-negative Unix seconds`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonZeroAddress(value: unknown): value is Address {
  return (
    typeof value === 'string' &&
    isAddress(value) &&
    value.toLowerCase() !== '0x0000000000000000000000000000000000000000'
  );
}

function isCalldata(value: unknown): value is Hex {
  return typeof value === 'string' && isHex(value) && value.length >= 10;
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
