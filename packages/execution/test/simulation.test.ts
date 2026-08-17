import { describe, expect, it, vi } from 'vitest';
import {
  POLICY_VERSION,
  createErc20TransferDecoder,
  evaluateSimulatedExecution,
  type EvaluateSimulatedExecutionInput,
  type ExecutionPolicy,
  type PolicyUsage,
  type RawExecutionRequest,
  type SimulationAdapter,
  type SimulationEvidence,
  type SupportedCallDecoder,
} from '../src/index.js';

const NOW = 1_800_000_000;
const BLOCK_NUMBER = 40_000_000n;
const PRINCIPAL = '0x1111111111111111111111111111111111111111';
const SENDER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const OTHER_TOKEN = '0x4444444444444444444444444444444444444444';
const RECIPIENT = '0x5555555555555555555555555555555555555555';

function transferCalldata(recipient: string, amount: bigint): `0x${string}` {
  const recipientWord = recipient.slice(2).padStart(64, '0');
  const amountWord = amount.toString(16).padStart(64, '0');
  return `0xa9059cbb${recipientWord}${amountWord}`;
}

function baseRequest(overrides: Partial<RawExecutionRequest> = {}): RawExecutionRequest {
  return {
    chainId: 56,
    agentId: '42',
    principal: PRINCIPAL,
    sender: SENDER,
    target: TOKEN,
    data: transferCalldata(RECIPIENT, 20n),
    nativeValue: 0n,
    requestedAt: NOW,
    ...overrides,
  };
}

function basePolicy(overrides: Partial<ExecutionPolicy> = {}): ExecutionPolicy {
  return {
    version: POLICY_VERSION,
    enabled: true,
    chainId: 56,
    agentId: '42',
    principal: PRINCIPAL,
    validAfter: NOW - 100,
    expiresAt: NOW + 100,
    calls: [{ target: TOKEN, selectors: ['0xa9059cbb'], maxNativeValue: 0n }],
    maxNativeValuePerTransaction: 1n,
    maxNativeValuePerDay: 10n,
    maxTransactionsPerDay: 5,
    tokenLimits: [{ token: TOKEN, maxPerTransaction: 100n, maxPerDay: 500n }],
    ...overrides,
  };
}

function baseUsage(overrides: Partial<PolicyUsage> = {}): PolicyUsage {
  return {
    nativeSpentToday: 0n,
    tokenSpentToday: [{ token: TOKEN, amount: 100n }],
    transactionsToday: 1,
    ...overrides,
  };
}

function successfulEvidence(overrides: Partial<SimulationEvidence> = {}): SimulationEvidence {
  return {
    success: true,
    blockNumber: BLOCK_NUMBER,
    gasUsed: 50_000n,
    returnData: '0x',
    ...overrides,
  };
}

function decoder(): SupportedCallDecoder {
  return createErc20TransferDecoder({ chainId: 56, token: TOKEN });
}

function simulator(result: unknown = successfulEvidence()): SimulationAdapter {
  return {
    name: 'test-simulator',
    simulate: vi.fn(async () => result),
  };
}

function baseInput(
  overrides: Partial<EvaluateSimulatedExecutionInput> = {},
): EvaluateSimulatedExecutionInput {
  return {
    request: baseRequest(),
    decoders: [decoder()],
    policy: basePolicy(),
    usage: baseUsage(),
    now: NOW,
    blockNumber: BLOCK_NUMBER,
    simulator: simulator(),
    ...overrides,
  };
}

describe('supported transaction simulation (M6)', () => {
  it('decodes, policy-checks, and simulates a supported ERC-20 transfer', async () => {
    const adapter = simulator();
    const result = await evaluateSimulatedExecution(baseInput({ simulator: adapter }));

    expect(result.approved).toBe(true);
    expect(result.rejectionReasons).toEqual([]);
    expect(result.request).toEqual(baseRequest());
    expect(result.intent?.tokenTransfers).toEqual([{ token: TOKEN, amount: 20n }]);
    expect(result.policyDecision?.approved).toBe(true);
    expect(result.simulation).toEqual(successfulEvidence());
    expect(adapter.simulate).toHaveBeenCalledWith({
      chainId: 56,
      from: SENDER,
      target: TOKEN,
      data: transferCalldata(RECIPIENT, 20n),
      value: 0n,
      blockNumber: BLOCK_NUMBER,
    });
  });

  it('returns identical results for identical explicit inputs and evidence', async () => {
    expect(await evaluateSimulatedExecution(baseInput())).toEqual(
      await evaluateSimulatedExecution(baseInput()),
    );
  });

  it('rejects malformed raw requests before decoding or simulation', async () => {
    const adapter = simulator();
    const result = await evaluateSimulatedExecution(
      baseInput({ request: { ...baseRequest(), data: '0x1234' }, simulator: adapter }),
    );
    expect(result.rejectionReasons).toEqual(['invalid-request']);
    expect(adapter.simulate).not.toHaveBeenCalled();
  });

  it('rejects calls with no registered decoder', async () => {
    const result = await evaluateSimulatedExecution(baseInput({ decoders: [] }));
    expect(result.rejectionReasons).toEqual(['unsupported-call']);
  });

  it('rejects ambiguous decoder matches', async () => {
    const first = decoder();
    const second = { ...decoder(), id: 'second-decoder' };
    const result = await evaluateSimulatedExecution(baseInput({ decoders: [first, second] }));
    expect(result.rejectionReasons).toEqual(['ambiguous-decoder']);
  });

  it('rejects malformed decoder registries', async () => {
    const first = decoder();
    const second = {
      ...createErc20TransferDecoder({ chainId: 56, token: OTHER_TOKEN }),
      id: first.id,
    };
    const result = await evaluateSimulatedExecution(baseInput({ decoders: [first, second] }));
    expect(result.rejectionReasons).toEqual(['invalid-context']);
  });

  it('fails closed when the selected decoder throws', async () => {
    const result = await evaluateSimulatedExecution(
      baseInput({ request: baseRequest({ data: transferCalldata(RECIPIENT, 0n) }) }),
    );
    expect(result.rejectionReasons).toEqual(['decode-failed']);
  });

  it('rejects malformed decoded token effects', async () => {
    const malformedDecoder: SupportedCallDecoder = {
      ...decoder(),
      id: 'malformed-effects',
      decode: () => ({ tokenTransfers: [{ token: TOKEN, amount: -1n }] }),
    };
    const result = await evaluateSimulatedExecution(baseInput({ decoders: [malformedDecoder] }));
    expect(result.rejectionReasons).toEqual(['invalid-decoded-intent']);
  });

  it('uses decoder-derived slippage when request metadata is absent', async () => {
    const swapDecoder: SupportedCallDecoder = {
      ...decoder(),
      id: 'decoded-slippage',
      decode: () => ({
        tokenTransfers: [{ token: TOKEN, amount: 20n }],
        slippageBps: 25,
      }),
    };
    const result = await evaluateSimulatedExecution(
      baseInput({
        decoders: [swapDecoder],
        policy: basePolicy({
          calls: [
            {
              target: TOKEN,
              selectors: ['0xa9059cbb'],
              requireSlippage: true,
              maxSlippageBps: 30,
            },
          ],
        }),
      }),
    );

    expect(result.approved).toBe(true);
    expect(result.intent?.slippageBps).toBe(25);
  });

  it('rejects conflicting request and decoder slippage', async () => {
    const swapDecoder: SupportedCallDecoder = {
      ...decoder(),
      id: 'conflicting-slippage',
      decode: () => ({
        tokenTransfers: [{ token: TOKEN, amount: 20n }],
        slippageBps: 25,
      }),
    };
    const result = await evaluateSimulatedExecution(
      baseInput({ decoders: [swapDecoder], request: baseRequest({ slippageBps: 26 }) }),
    );

    expect(result.rejectionReasons).toEqual(['invalid-decoded-intent']);
  });

  it('rejects malformed decoder-derived slippage', async () => {
    const swapDecoder: SupportedCallDecoder = {
      ...decoder(),
      id: 'invalid-slippage',
      decode: () => ({
        tokenTransfers: [{ token: TOKEN, amount: 20n }],
        slippageBps: 10_001,
      }),
    };
    const result = await evaluateSimulatedExecution(baseInput({ decoders: [swapDecoder] }));

    expect(result.rejectionReasons).toEqual(['invalid-decoded-intent']);
  });

  it('does not simulate when M5 rejects the normalized intent', async () => {
    const adapter = simulator();
    const result = await evaluateSimulatedExecution(
      baseInput({ policy: basePolicy({ enabled: false }), simulator: adapter }),
    );
    expect(result.rejectionReasons).toEqual(['policy-rejected']);
    expect(result.policyDecision?.rejectionReasons).toContain('policy-disabled');
    expect(adapter.simulate).not.toHaveBeenCalled();
  });

  it('rejects invalid block or simulator context', async () => {
    expect(
      (await evaluateSimulatedExecution(baseInput({ blockNumber: -1n }))).rejectionReasons,
    ).toEqual(['invalid-context']);
    expect(
      (await evaluateSimulatedExecution(baseInput({ simulator: null }))).rejectionReasons,
    ).toEqual(['invalid-context']);
  });

  it('rejects unavailable simulation providers', async () => {
    const adapter: SimulationAdapter = {
      name: 'offline-simulator',
      simulate: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    const result = await evaluateSimulatedExecution(baseInput({ simulator: adapter }));
    expect(result.rejectionReasons).toEqual(['simulation-unavailable']);
  });

  it('rejects malformed simulation evidence', async () => {
    const result = await evaluateSimulatedExecution(
      baseInput({ simulator: simulator({ success: true }) }),
    );
    expect(result.rejectionReasons).toEqual(['invalid-simulation']);
  });

  it('rejects simulation evidence from a different block', async () => {
    const result = await evaluateSimulatedExecution(
      baseInput({ simulator: simulator(successfulEvidence({ blockNumber: BLOCK_NUMBER + 1n })) }),
    );
    expect(result.rejectionReasons).toEqual(['invalid-simulation']);
  });

  it('rejects reverted simulations while retaining their evidence', async () => {
    const evidence = successfulEvidence({ success: false, revertReason: 'insufficient balance' });
    const result = await evaluateSimulatedExecution(baseInput({ simulator: simulator(evidence) }));
    expect(result.rejectionReasons).toEqual(['simulation-reverted']);
    expect(result.simulation).toEqual(evidence);
  });
});
