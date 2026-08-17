import { CurrencyAmount, Token, TradeType } from '@pancakeswap/sdk';
import { PoolType, RouteType, type SmartRouterTrade } from '@pancakeswap/smart-router';
import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { describe, expect, it, vi } from 'vitest';
import {
  POLICY_VERSION,
  evaluateSimulatedExecution,
  type ExecutionPolicy,
  type RawExecutionRequest,
} from '@ambit/execution';
import {
  PANCAKESWAP_INTEGRATION_VERSION,
  PANCAKESWAP_PROTOCOL,
  PANCAKESWAP_SMART_ROUTER_VERSION,
  PANCAKESWAP_UNIVERSAL_ROUTER_SDK_VERSION,
  PancakeSwapIntegrationError,
  buildPancakeSwapExactInputPlan,
  createPancakeSwapExactInputDecoder,
  createPancakeSwapExactInputPlan,
  getPancakeSwapUniversalRouter,
  type PancakeSwapExactInputQuoteInput,
} from '../src/index.js';

const NOW = 1_800_000_000;
const QUOTED_AT = NOW - 10;
const DEADLINE = NOW + 300;
const QUOTE_BLOCK = 40_000_000n;
const TOKEN_IN = '0x1111111111111111111111111111111111111111';
const TOKEN_OUT = '0x2222222222222222222222222222222222222222';
const SENDER = '0x3333333333333333333333333333333333333333';
const PRINCIPAL = '0x4444444444444444444444444444444444444444';
const AMOUNT_IN = 100n;
const QUOTED_AMOUNT_OUT = 200n;
const SLIPPAGE_BPS = 500;
const MINIMUM_AMOUNT_OUT = 190n;

const executeWithDeadlineAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);
const executeWithoutDeadlineAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs) payable',
]);
const v2ExactInputParameters = parseAbiParameters(
  'address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser',
);
const v2ExactOutputParameters = parseAbiParameters(
  'address recipient, uint256 amountOut, uint256 amountInMax, address[] path, bool payerIsUser',
);
const v3ExactInputParameters = parseAbiParameters(
  'address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser',
);

interface SwapCalldataOptions {
  recipient?: Address;
  amountIn?: bigint;
  amountOutMin?: bigint;
  tokenIn?: Address;
  tokenOut?: Address;
  payerIsUser?: boolean;
  deadline?: number;
}

function v2Calldata(options: SwapCalldataOptions = {}): Hex {
  const input = encodeAbiParameters(v2ExactInputParameters, [
    options.recipient ?? SENDER,
    options.amountIn ?? AMOUNT_IN,
    options.amountOutMin ?? MINIMUM_AMOUNT_OUT,
    [options.tokenIn ?? TOKEN_IN, options.tokenOut ?? TOKEN_OUT],
    options.payerIsUser ?? true,
  ]);
  return executeCalldata('0x08', [input], options.deadline ?? DEADLINE);
}

function v3Calldata(options: SwapCalldataOptions = {}): Hex {
  const path = concatHex([
    options.tokenIn ?? TOKEN_IN,
    toHex(2_500, { size: 3 }),
    options.tokenOut ?? TOKEN_OUT,
  ]);
  const input = encodeAbiParameters(v3ExactInputParameters, [
    options.recipient ?? SENDER,
    options.amountIn ?? AMOUNT_IN,
    options.amountOutMin ?? MINIMUM_AMOUNT_OUT,
    path,
    options.payerIsUser ?? true,
  ]);
  return executeCalldata('0x00', [input], options.deadline ?? DEADLINE);
}

function executeCalldata(commands: Hex, inputs: readonly Hex[], deadline: number): Hex {
  return encodeFunctionData({
    abi: executeWithDeadlineAbi,
    functionName: 'execute',
    args: [commands, inputs, BigInt(deadline)],
  });
}

function quoteInput(
  overrides: Partial<PancakeSwapExactInputQuoteInput> = {},
): PancakeSwapExactInputQuoteInput {
  return {
    chainId: 56,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amountIn: AMOUNT_IN,
    quotedAmountOut: QUOTED_AMOUNT_OUT,
    slippageBps: SLIPPAGE_BPS,
    recipient: SENDER,
    quoteBlockNumber: QUOTE_BLOCK,
    quotedAt: QUOTED_AT,
    deadline: DEADLINE,
    calldata: v2Calldata(),
    nativeValue: 0n,
    ...overrides,
  };
}

function request(
  plan = createPancakeSwapExactInputPlan(quoteInput(), NOW),
  overrides: Partial<RawExecutionRequest> = {},
): RawExecutionRequest {
  return {
    chainId: plan.chainId,
    agentId: '42',
    principal: PRINCIPAL,
    sender: SENDER,
    target: plan.router,
    data: plan.calldata,
    nativeValue: 0n,
    protocol: PANCAKESWAP_PROTOCOL,
    requestedAt: NOW,
    ...overrides,
  };
}

function policy(plan = createPancakeSwapExactInputPlan(quoteInput(), NOW)): ExecutionPolicy {
  return {
    version: POLICY_VERSION,
    enabled: true,
    chainId: plan.chainId,
    agentId: '42',
    principal: PRINCIPAL,
    validAfter: NOW - 100,
    expiresAt: NOW + 100,
    calls: [
      {
        target: plan.router,
        selectors: [createPancakeSwapExactInputDecoder(plan).selector],
        protocol: PANCAKESWAP_PROTOCOL,
        maxNativeValue: 0n,
        maxSlippageBps: SLIPPAGE_BPS,
        requireSlippage: true,
      },
    ],
    maxNativeValuePerTransaction: 0n,
    maxNativeValuePerDay: 0n,
    maxTransactionsPerDay: 5,
    tokenLimits: [{ token: TOKEN_IN, maxPerTransaction: AMOUNT_IN, maxPerDay: 1_000n }],
  };
}

function smartRouterTrade(): SmartRouterTrade<TradeType.EXACT_INPUT> {
  const tokenIn = new Token(56, TOKEN_IN, 18, 'TIN', 'Token In');
  const tokenOut = new Token(56, TOKEN_OUT, 18, 'TOUT', 'Token Out');
  const inputAmount = CurrencyAmount.fromRawAmount(tokenIn, AMOUNT_IN);
  const outputAmount = CurrencyAmount.fromRawAmount(tokenOut, QUOTED_AMOUNT_OUT);
  return {
    tradeType: TradeType.EXACT_INPUT,
    inputAmount,
    outputAmount,
    gasEstimate: 100_000n,
    blockNumber: Number(QUOTE_BLOCK),
    routes: [
      {
        type: RouteType.V2,
        pools: [
          {
            type: PoolType.V2,
            reserve0: CurrencyAmount.fromRawAmount(tokenIn, 10_000n),
            reserve1: CurrencyAmount.fromRawAmount(tokenOut, 20_000n),
          },
        ],
        path: [tokenIn, tokenOut],
        percent: 100,
        inputAmount,
        outputAmount,
      },
    ],
  };
}

describe('PancakeSwap integration (M12)', () => {
  it('pins the verified installable official SDK pair', () => {
    expect(PANCAKESWAP_INTEGRATION_VERSION).toBe('v1.0.0');
    expect(PANCAKESWAP_SMART_ROUTER_VERSION).toBe('7.6.1');
    expect(PANCAKESWAP_UNIVERSAL_ROUTER_SDK_VERSION).toBe('1.5.2');
    expect(getPancakeSwapUniversalRouter(56)).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(getPancakeSwapUniversalRouter(97)).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(() => getPancakeSwapUniversalRouter(1)).toThrowError(
      expect.objectContaining({ code: 'unsupported-chain' }),
    );
  });

  it('builds and revalidates a real official V2 Universal Router call', () => {
    const plan = buildPancakeSwapExactInputPlan(
      {
        trade: smartRouterTrade(),
        sender: SENDER,
        slippageBps: SLIPPAGE_BPS,
        quotedAt: QUOTED_AT,
        deadline: DEADLINE,
      },
      NOW,
    );

    expect(plan.command).toBe('V2_SWAP_EXACT_IN');
    expect(plan.minimumAmountOut).toBe(MINIMUM_AMOUNT_OUT);
    expect(plan.tokenIn).toBe(TOKEN_IN);
    expect(plan.tokenOut).toBe(TOKEN_OUT);
    expect(plan.nativeValue).toBe(0n);
  });

  it('validates quote-bound V2 and V3 exact-input calldata', () => {
    const v2Plan = createPancakeSwapExactInputPlan(quoteInput(), NOW);
    const v3Plan = createPancakeSwapExactInputPlan(quoteInput({ calldata: v3Calldata() }), NOW);

    expect(v2Plan.command).toBe('V2_SWAP_EXACT_IN');
    expect(v3Plan.command).toBe('V3_SWAP_EXACT_IN');
    expect(v3Plan.minimumAmountOut).toBe(MINIMUM_AMOUNT_OUT);
  });

  it('rejects quote, route, recipient, deadline, and native-value mismatches', () => {
    const cases: Array<[unknown, string]> = [
      [quoteInput({ chainId: 1 }), 'unsupported-chain'],
      [
        quoteInput({ deadline: NOW - 1, calldata: v2Calldata({ deadline: NOW - 1 }) }),
        'expired-quote',
      ],
      [quoteInput({ nativeValue: 1n }), 'unsupported-command'],
      [
        quoteInput({ calldata: v2Calldata({ amountOutMin: MINIMUM_AMOUNT_OUT - 1n }) }),
        'quote-mismatch',
      ],
      [quoteInput({ calldata: v2Calldata({ recipient: PRINCIPAL }) }), 'quote-mismatch'],
      [quoteInput({ calldata: v2Calldata({ tokenOut: PRINCIPAL }) }), 'quote-mismatch'],
      [quoteInput({ calldata: v2Calldata({ payerIsUser: false }) }), 'unsupported-command'],
    ];

    for (const [input, code] of cases) {
      expect(() => createPancakeSwapExactInputPlan(input, NOW)).toThrowError(
        expect.objectContaining({ code }),
      );
    }
  });

  it('rejects exact-output, multi-command, and no-deadline router plans', () => {
    const exactOutputInput = encodeAbiParameters(v2ExactOutputParameters, [
      SENDER,
      QUOTED_AMOUNT_OUT,
      AMOUNT_IN,
      [TOKEN_IN, TOKEN_OUT],
      true,
    ]);
    const exactOutput = executeCalldata('0x09', [exactOutputInput], DEADLINE);
    const validInput = encodeAbiParameters(v2ExactInputParameters, [
      SENDER,
      AMOUNT_IN,
      MINIMUM_AMOUNT_OUT,
      [TOKEN_IN, TOKEN_OUT],
      true,
    ]);
    const multiple = executeCalldata('0x0808', [validInput, validInput], DEADLINE);
    const noDeadline = encodeFunctionData({
      abi: executeWithoutDeadlineAbi,
      functionName: 'execute',
      args: ['0x08', [validInput]],
    });

    for (const calldata of [exactOutput, multiple]) {
      expect(() => createPancakeSwapExactInputPlan(quoteInput({ calldata }), NOW)).toThrowError(
        expect.objectContaining({ code: 'unsupported-command' }),
      );
    }
    expect(() =>
      createPancakeSwapExactInputPlan(quoteInput({ calldata: noDeadline }), NOW),
    ).toThrowError(expect.objectContaining({ code: 'invalid-router-call' }));
  });

  it('binds the decoder to exact calldata, sender, time, and slippage evidence', () => {
    const plan = createPancakeSwapExactInputPlan(quoteInput(), NOW);
    const decoder = createPancakeSwapExactInputDecoder(plan);

    expect(decoder.decode(request(plan))).toEqual({
      tokenTransfers: [{ token: TOKEN_IN, amount: AMOUNT_IN }],
      slippageBps: SLIPPAGE_BPS,
    });

    const mismatches = [
      request(plan, { data: v2Calldata({ amountIn: AMOUNT_IN + 1n }) }),
      request(plan, { sender: PRINCIPAL }),
      request(plan, { requestedAt: DEADLINE }),
      request(plan, { slippageBps: SLIPPAGE_BPS - 1 }),
    ];
    for (const mismatch of mismatches) {
      expect(() => decoder.decode(mismatch)).toThrow(PancakeSwapIntegrationError);
    }
  });

  it('flows decoded spend and slippage through policy before simulation', async () => {
    const plan = createPancakeSwapExactInputPlan(quoteInput(), NOW);
    const simulator = {
      name: 'm12-simulator',
      simulate: vi.fn(async () => ({
        success: true,
        blockNumber: QUOTE_BLOCK,
        gasUsed: 150_000n,
        returnData: '0x' as Hex,
      })),
    };
    const result = await evaluateSimulatedExecution({
      request: request(plan),
      decoders: [createPancakeSwapExactInputDecoder(plan)],
      policy: policy(plan),
      usage: { nativeSpentToday: 0n, tokenSpentToday: [], transactionsToday: 0 },
      now: NOW,
      blockNumber: QUOTE_BLOCK,
      simulator,
    });

    expect(result.approved).toBe(true);
    expect(result.intent?.tokenTransfers).toEqual([{ token: TOKEN_IN, amount: AMOUNT_IN }]);
    expect(result.intent?.slippageBps).toBe(SLIPPAGE_BPS);
    expect(simulator.simulate).toHaveBeenCalledOnce();
  });

  it('fails before simulation when the bound calldata is tampered', async () => {
    const plan = createPancakeSwapExactInputPlan(quoteInput(), NOW);
    const simulator = { name: 'm12-simulator', simulate: vi.fn() };
    const result = await evaluateSimulatedExecution({
      request: request(plan, { data: v2Calldata({ amountIn: AMOUNT_IN + 1n }) }),
      decoders: [createPancakeSwapExactInputDecoder(plan)],
      policy: policy(plan),
      usage: { nativeSpentToday: 0n, tokenSpentToday: [], transactionsToday: 0 },
      now: NOW,
      blockNumber: QUOTE_BLOCK,
      simulator,
    });

    expect(result.rejectionReasons).toEqual(['decode-failed']);
    expect(simulator.simulate).not.toHaveBeenCalled();
  });
});
