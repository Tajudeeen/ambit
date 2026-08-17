import {
  POLICY_VERSION,
  createErc20TransferDecoder,
  evaluateSimulatedExecution,
  type ExecutionPipelineDecision,
  type ExecutionPolicy,
  type PolicyUsage,
  type RawExecutionRequest,
} from '@ambit/execution';
import { encodeFunctionData, toFunctionSelector, type Address, type Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import {
  createViemExecutionReceiptClient,
  verifyAndRecordExecutionPassport,
  type ExecutionPassport,
  type ExecutionPassportStore,
  type ExecutionReceiptClient,
  type ReceiptBlock,
  type ReceiptRecord,
  type ReceiptTransaction,
  type VerifyAndRecordExecutionPassportInput,
} from '../src/index.js';

const CHAIN_ID = 56;
const AGENT_ID = '42';
const NOW = 1_800_000_000;
const REQUESTED_AT = NOW - 60;
const SIMULATION_BLOCK = 100n;
const RECEIPT_BLOCK = 120n;
const LATEST_BLOCK = 125n;
const PRINCIPAL = '0x1111111111111111111111111111111111111111' as Address;
const SENDER = '0x2222222222222222222222222222222222222222' as Address;
const TOKEN = '0x3333333333333333333333333333333333333333' as Address;
const RECIPIENT = '0x4444444444444444444444444444444444444444' as Address;
const OTHER = '0x5555555555555555555555555555555555555555' as Address;
const TRANSACTION_HASH = `0x${'aa'.repeat(32)}` as Hex;
const OTHER_HASH = `0x${'bb'.repeat(32)}` as Hex;
const BLOCK_HASH = `0x${'cc'.repeat(32)}` as Hex;
const OTHER_BLOCK_HASH = `0x${'dd'.repeat(32)}` as Hex;
const CALLS_ID = '0x1234' as Hex;
const SELECTOR = toFunctionSelector('transfer(address,uint256)');
const DATA = encodeFunctionData({
  abi: [
    {
      type: 'function',
      name: 'transfer',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    },
  ],
  functionName: 'transfer',
  args: [RECIPIENT, 25n],
});

function request(overrides: Partial<RawExecutionRequest> = {}): RawExecutionRequest {
  return {
    chainId: CHAIN_ID,
    agentId: AGENT_ID,
    principal: PRINCIPAL,
    sender: SENDER,
    target: TOKEN,
    data: DATA,
    nativeValue: 0n,
    protocol: 'erc20',
    requestedAt: REQUESTED_AT,
    ...overrides,
  };
}

function policy(): ExecutionPolicy {
  return {
    version: POLICY_VERSION,
    enabled: true,
    chainId: CHAIN_ID,
    agentId: AGENT_ID,
    principal: PRINCIPAL,
    expiresAt: NOW + 600,
    calls: [{ target: TOKEN, selectors: [SELECTOR], protocol: 'erc20' }],
    maxNativeValuePerTransaction: 0n,
    maxNativeValuePerDay: 0n,
    tokenLimits: [{ token: TOKEN, maxPerTransaction: 100n, maxPerDay: 1_000n }],
  };
}

function usage(): PolicyUsage {
  return { nativeSpentToday: 0n, tokenSpentToday: [], transactionsToday: 0 };
}

async function approvedPipeline(): Promise<ExecutionPipelineDecision> {
  return evaluateSimulatedExecution({
    request: request(),
    decoders: [createErc20TransferDecoder({ chainId: CHAIN_ID, token: TOKEN, protocol: 'erc20' })],
    policy: policy(),
    usage: usage(),
    now: NOW,
    blockNumber: SIMULATION_BLOCK,
    simulator: {
      name: 'passport-test',
      simulate: vi.fn(async () => ({
        success: true,
        blockNumber: SIMULATION_BLOCK,
        gasUsed: 50_000n,
        returnData: '0x',
      })),
    },
  });
}

function altanaDecision(overrides: Record<string, unknown> = {}) {
  return {
    submitted: true,
    checks: [],
    rejectionReasons: [],
    callsId: CALLS_ID,
    transactionHash: TRANSACTION_HASH,
    relayStatus: 'CONFIRMED',
    ...overrides,
  };
}

function transaction(overrides: Partial<ReceiptTransaction> = {}): ReceiptTransaction {
  return {
    hash: TRANSACTION_HASH,
    chainId: CHAIN_ID,
    from: SENDER,
    to: TOKEN,
    input: DATA,
    value: 0n,
    blockNumber: RECEIPT_BLOCK,
    blockHash: BLOCK_HASH,
    ...overrides,
  };
}

function receipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    transactionHash: TRANSACTION_HASH,
    from: SENDER,
    to: TOKEN,
    status: 'success',
    blockNumber: RECEIPT_BLOCK,
    blockHash: BLOCK_HASH,
    gasUsed: 45_000n,
    effectiveGasPrice: 3_000_000_000n,
    ...overrides,
  };
}

function block(overrides: Partial<ReceiptBlock> = {}): ReceiptBlock {
  return {
    number: RECEIPT_BLOCK,
    hash: BLOCK_HASH,
    timestamp: 1_799_999_990n,
    ...overrides,
  };
}

function receiptClient(overrides: Partial<ExecutionReceiptClient> = {}) {
  const client: ExecutionReceiptClient = {
    chainId: CHAIN_ID,
    getTransaction: vi.fn(async () => transaction()),
    getTransactionReceipt: vi.fn(async () => receipt()),
    getBlock: vi.fn(async () => block()),
    getBlockNumber: vi.fn(async () => LATEST_BLOCK),
    ...overrides,
  };
  return client;
}

function passportStore(
  implementation?: (passport: ExecutionPassport) => Promise<unknown>,
): ExecutionPassportStore {
  return {
    record: vi.fn(implementation ?? (async (passport) => ({ status: 'created', passport }))),
  };
}

async function baseInput(
  overrides: Partial<VerifyAndRecordExecutionPassportInput> = {},
): Promise<VerifyAndRecordExecutionPassportInput> {
  return {
    pipelineDecision: await approvedPipeline(),
    altanaDecision: altanaDecision(),
    client: receiptClient(),
    store: passportStore(),
    requiredConfirmations: 3,
    verifiedAt: NOW,
    ...overrides,
  };
}

describe('M8 execution passports', () => {
  it('records a deterministic passport only after exact receipt verification', async () => {
    const store = passportStore();
    const result = await verifyAndRecordExecutionPassport(await baseInput({ store }));

    expect(result.recorded).toBe(true);
    expect(result.successful).toBe(true);
    expect(result.rejectionReasons).toEqual([]);
    expect(result.passport).toMatchObject({
      version: 'v0.1.0',
      chainId: CHAIN_ID,
      agentId: AGENT_ID,
      sender: SENDER,
      target: TOKEN,
      calldata: DATA,
      selector: SELECTOR,
      decoderId: `erc20-transfer:${CHAIN_ID}:${TOKEN.toLowerCase()}`,
      altana: {
        callsId: CALLS_ID,
        relayStatus: 'CONFIRMED',
        transactionHash: TRANSACTION_HASH,
      },
      receipt: {
        outcome: 'succeeded',
        blockNumber: RECEIPT_BLOCK,
        blockHash: BLOCK_HASH,
        confirmations: 6n,
      },
      verifiedAt: NOW,
    });
    expect(result.passport?.id).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(result.passport).not.toHaveProperty('session');
    expect(store.record).toHaveBeenCalledWith(result.passport);
  });

  it('records reverted receipts as evidence without a success claim', async () => {
    const client = receiptClient({
      getTransactionReceipt: vi.fn(async () => receipt({ status: 'reverted' })),
    });
    const result = await verifyAndRecordExecutionPassport(
      await baseInput({ altanaDecision: altanaDecision({ relayStatus: 'PENDING' }), client }),
    );

    expect(result.recorded).toBe(true);
    expect(result.successful).toBe(false);
    expect(result.passport?.receipt.outcome).toBe('reverted');
    expect(result.passport?.altana.relayStatus).toBe('PENDING');
  });

  it('accepts an idempotent existing passport from the store', async () => {
    const store = passportStore(async (passport) => ({ status: 'existing', passport }));
    const result = await verifyAndRecordExecutionPassport(await baseInput({ store }));
    expect(result.recorded).toBe(true);
    expect(result.checks.at(-1)?.detail).toContain('existing');
  });

  it('adapts configured viem public clients and rejects unconfigured clients', async () => {
    const getBlockNumber = vi.fn(async () => LATEST_BLOCK);
    const adapted = createViemExecutionReceiptClient({
      chain: { id: CHAIN_ID },
      getTransaction: vi.fn(async () => transaction()),
      getTransactionReceipt: vi.fn(async () => receipt()),
      getBlock: vi.fn(async () => block()),
      getBlockNumber,
    });

    expect(adapted.chainId).toBe(CHAIN_ID);
    await expect(adapted.getBlockNumber()).resolves.toBe(LATEST_BLOCK);
    expect(getBlockNumber).toHaveBeenCalledOnce();
    expect(() =>
      createViemExecutionReceiptClient({
        getTransaction: vi.fn(),
        getTransactionReceipt: vi.fn(),
        getBlock: vi.fn(),
        getBlockNumber: vi.fn(),
      }),
    ).toThrow(/configured positive chain ID/u);
  });

  it.each([
    ['zero confirmations', { requiredConfirmations: 0 }],
    ['verification before request', { verifiedAt: REQUESTED_AT - 1 }],
    ['wrong client chain', { client: receiptClient({ chainId: 97 }) }],
  ])('rejects invalid context: %s', async (_label, overrides) => {
    const result = await verifyAndRecordExecutionPassport(await baseInput(overrides));
    expect(result.rejectionReasons).toEqual(['invalid-context']);
    expect(result.recorded).toBe(false);
  });

  it('rejects unapproved M6 decisions before reading chain state', async () => {
    const client = receiptClient();
    const pipeline = { ...(await approvedPipeline()), approved: false };
    const result = await verifyAndRecordExecutionPassport(
      await baseInput({ pipelineDecision: pipeline, client }),
    );

    expect(result.rejectionReasons).toEqual(['invalid-pipeline-decision']);
    expect(client.getTransaction).not.toHaveBeenCalled();
  });

  it('rejects malformed M7 relay decisions before reading chain state', async () => {
    const client = receiptClient();
    const result = await verifyAndRecordExecutionPassport(
      await baseInput({ altanaDecision: altanaDecision({ transactionHash: '0x' }), client }),
    );

    expect(result.rejectionReasons).toEqual(['invalid-altana-decision']);
    expect(client.getTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when transaction or receipt reads are unavailable or malformed', async () => {
    const unavailable = receiptClient({
      getTransaction: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const malformed = receiptClient({
      getTransactionReceipt: vi.fn(async () => ({ status: 'success' })),
    });

    await expect(
      verifyAndRecordExecutionPassport(await baseInput({ client: unavailable })),
    ).resolves.toMatchObject({ rejectionReasons: ['chain-unavailable'] });
    await expect(
      verifyAndRecordExecutionPassport(await baseInput({ client: malformed })),
    ).resolves.toMatchObject({ rejectionReasons: ['chain-unavailable'] });
  });

  it('rejects every exact transaction binding mismatch', async () => {
    const mismatches: Array<Partial<ReceiptTransaction>> = [
      { hash: OTHER_HASH },
      { chainId: 97 },
      { from: OTHER },
      { to: OTHER },
      { input: '0x12345678' },
      { value: 1n },
      { blockNumber: null },
      { blockHash: null },
    ];

    for (const mismatch of mismatches) {
      const store = passportStore();
      const client = receiptClient({
        getTransaction: vi.fn(async () => transaction(mismatch)),
      });
      const result = await verifyAndRecordExecutionPassport(await baseInput({ client, store }));
      expect(result.rejectionReasons).toEqual(['transaction-mismatch']);
      expect(store.record).not.toHaveBeenCalled();
    }
  });

  it('rejects receipt fields that do not bind to the mined transaction', async () => {
    const mismatches: Array<Partial<ReceiptRecord>> = [
      { transactionHash: OTHER_HASH },
      { from: OTHER },
      { to: OTHER },
      { blockNumber: RECEIPT_BLOCK + 1n },
      { blockHash: OTHER_BLOCK_HASH },
    ];

    for (const mismatch of mismatches) {
      const store = passportStore();
      const client = receiptClient({
        getTransactionReceipt: vi.fn(async () => receipt(mismatch)),
      });
      const result = await verifyAndRecordExecutionPassport(await baseInput({ client, store }));
      expect(result.rejectionReasons).toEqual(['receipt-mismatch']);
      expect(store.record).not.toHaveBeenCalled();
    }
  });

  it('rejects a receipt block that does not resolve canonically', async () => {
    const client = receiptClient({
      getBlock: vi.fn(async () => block({ hash: OTHER_BLOCK_HASH })),
    });
    const result = await verifyAndRecordExecutionPassport(await baseInput({ client }));
    expect(result.rejectionReasons).toEqual(['block-mismatch']);
  });

  it('fails closed when the canonical block cannot be read', async () => {
    const client = receiptClient({
      getBlock: vi.fn(async () => {
        throw new Error('pruned');
      }),
    });
    const result = await verifyAndRecordExecutionPassport(await baseInput({ client }));
    expect(result.rejectionReasons).toEqual(['chain-unavailable']);
  });

  it('requires the caller-selected confirmation depth', async () => {
    const client = receiptClient({ getBlockNumber: vi.fn(async () => RECEIPT_BLOCK) });
    const result = await verifyAndRecordExecutionPassport(
      await baseInput({ client, requiredConfirmations: 2 }),
    );
    expect(result.rejectionReasons).toEqual(['insufficient-confirmations']);
  });

  it('does not claim a passport when persistence fails', async () => {
    const store = passportStore(async () => {
      throw new Error('database offline');
    });
    const result = await verifyAndRecordExecutionPassport(await baseInput({ store }));
    expect(result.rejectionReasons).toEqual(['persistence-failed']);
    expect(result.passport).toBeUndefined();
  });

  it('rejects conflicting or malformed idempotent store results', async () => {
    const conflict = passportStore(async (passport) => ({
      status: 'existing',
      passport: { ...passport, verifiedAt: passport.verifiedAt + 1 },
    }));
    const malformed = passportStore(async (passport) => ({ status: 'unknown', passport }));

    await expect(
      verifyAndRecordExecutionPassport(await baseInput({ store: conflict })),
    ).resolves.toMatchObject({ rejectionReasons: ['persistence-conflict'] });
    await expect(
      verifyAndRecordExecutionPassport(await baseInput({ store: malformed })),
    ).resolves.toMatchObject({ rejectionReasons: ['persistence-conflict'] });
  });

  it('derives the same passport ID for the same chain transaction', async () => {
    const first = await verifyAndRecordExecutionPassport(await baseInput());
    const second = await verifyAndRecordExecutionPassport(await baseInput());
    expect(first.passport?.id).toBe(second.passport?.id);
  });
});
