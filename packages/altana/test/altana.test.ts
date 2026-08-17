import { describe, expect, it, vi } from 'vitest';
import {
  POLICY_VERSION,
  createErc20TransferDecoder,
  evaluateSimulatedExecution,
  type ExecutionPipelineDecision,
  type ExecutionPolicy,
  type PolicyUsage,
  type RawExecutionRequest,
} from '@ambit/execution';
import {
  ALTANA_SDK_VERSION,
  AltanaAdminAdapter,
  AltanaSessionExecutor,
  createOfficialAltanaClient,
  type AltanaClient,
  type AltanaSession,
  type AltanaSessionPermissions,
  type AltanaSigner,
  type RegisteredAltanaSession,
} from '../src/index.js';

const NOW = 1_800_000_000;
const BLOCK_NUMBER = 40_000_000n;
const PRINCIPAL = '0x1111111111111111111111111111111111111111';
const SENDER = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const OTHER = '0x4444444444444444444444444444444444444444';
const RECIPIENT = '0x5555555555555555555555555555555555555555';
const PUBLIC_KEY = `0x02${'11'.repeat(32)}` as const;
const CALLS_ID = `0x${'aa'.repeat(32)}` as const;
const TRANSACTION_HASH = `0x${'bb'.repeat(32)}` as const;

function transferCalldata(recipient: string, amount: bigint): `0x${string}` {
  return `0xa9059cbb${recipient.slice(2).padStart(64, '0')}${amount
    .toString(16)
    .padStart(64, '0')}`;
}

function signer(address = PRINCIPAL): AltanaSigner {
  return {
    type: 'privateKey',
    address,
    publicKey: PUBLIC_KEY,
    signDigest: vi.fn(async () => `0x${'cc'.repeat(65)}`),
  };
}

function permissions(overrides: Partial<AltanaSessionPermissions> = {}): AltanaSessionPermissions {
  return {
    calls: [{ to: TOKEN, signature: 'transfer(address,uint256)' }],
    spend: [
      { limit: 1_000_000n, period: 'day' },
      { token: TOKEN, limit: 100n, period: 'day' },
    ],
    ...overrides,
  };
}

function session(overrides: Partial<AltanaSession> = {}): AltanaSession {
  return {
    walletAddress: SENDER,
    signer: signer(SENDER),
    publicKey: PUBLIC_KEY,
    permissions: permissions(),
    expiry: NOW + 100,
    ...overrides,
  };
}

function registeredSession(overrides: Partial<AltanaSession> = {}): RegisteredAltanaSession {
  return { registration: 'registered', grantedAt: NOW, session: session(overrides) };
}

function clientMocks(
  chainId = 56,
  options: {
    executeResult?: unknown;
    grantResult?: unknown;
    revokeResult?: unknown;
  } = {},
): {
  client: AltanaClient;
  execute: ReturnType<typeof vi.fn>;
  grantSession: ReturnType<typeof vi.fn>;
  revokeSession: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(
    async () =>
      options.executeResult ?? {
        callsId: CALLS_ID,
        transactionHash: TRANSACTION_HASH,
        status: 'CONFIRMED',
      },
  );
  const grantSession = vi.fn(async () => options.grantResult ?? session());
  const revokeSession = vi.fn(
    async () =>
      options.revokeResult ?? {
        callsId: CALLS_ID,
        transactionHash: TRANSACTION_HASH,
        status: 'CONFIRMED',
      },
  );
  const client = {
    chains: [{ chainId }],
    defaultChainId: chainId,
    execute,
    grantSession,
    revokeSession,
  } as unknown as AltanaClient;
  return { client, execute, grantSession, revokeSession };
}

function request(overrides: Partial<RawExecutionRequest> = {}): RawExecutionRequest {
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

function policy(overrides: Partial<ExecutionPolicy> = {}): ExecutionPolicy {
  return {
    version: POLICY_VERSION,
    enabled: true,
    chainId: 56,
    agentId: '42',
    principal: PRINCIPAL,
    expiresAt: NOW + 100,
    calls: [{ target: TOKEN, selectors: ['0xa9059cbb'], maxNativeValue: 0n }],
    maxNativeValuePerTransaction: 1n,
    maxNativeValuePerDay: 10n,
    tokenLimits: [{ token: TOKEN, maxPerTransaction: 100n, maxPerDay: 500n }],
    ...overrides,
  };
}

function usage(): PolicyUsage {
  return { nativeSpentToday: 0n, tokenSpentToday: [], transactionsToday: 0 };
}

async function approvedDecision(
  requestOverrides: Partial<RawExecutionRequest> = {},
): Promise<ExecutionPipelineDecision> {
  return evaluateSimulatedExecution({
    request: request(requestOverrides),
    decoders: [createErc20TransferDecoder({ chainId: 56, token: TOKEN })],
    policy: policy(),
    usage: usage(),
    now: NOW,
    blockNumber: BLOCK_NUMBER,
    simulator: {
      name: 'test-simulator',
      simulate: vi.fn(async () => ({
        success: true,
        blockNumber: BLOCK_NUMBER,
        gasUsed: 50_000n,
        returnData: '0x',
      })),
    },
  });
}

describe('official Altana integration (M7)', () => {
  it('uses the pinned SDK and official BNB network presets', () => {
    expect(ALTANA_SDK_VERSION).toBe('0.5.1');
    expect(createOfficialAltanaClient('bnb-mainnet').chains[0]?.chainId).toBe(56);
    expect(createOfficialAltanaClient('bnb-testnet').chains[0]?.chainId).toBe(97);
  });

  it('grants only registered sessions with explicit bounded permissions', async () => {
    const mocks = clientMocks();
    const adapter = new AltanaAdminAdapter({
      client: mocks.client,
      chainId: 56,
      wallet: { address: SENDER },
      signer: signer(),
    });
    const grant = await adapter.grantRegisteredSession({
      permissions: permissions(),
      expiry: NOW + 100,
      now: NOW,
    });

    expect(grant).toMatchObject({ registration: 'registered', grantedAt: NOW });
    expect(mocks.grantSession).toHaveBeenCalledWith(
      expect.objectContaining({ register: true, chainId: 56, expiry: NOW + 100 }),
    );
  });

  it('rejects expired or unbounded grants before calling the SDK', async () => {
    const mocks = clientMocks();
    const adapter = new AltanaAdminAdapter({
      client: mocks.client,
      chainId: 56,
      wallet: { address: SENDER },
      signer: signer(),
    });

    await expect(
      adapter.grantRegisteredSession({
        permissions: { calls: [], spend: [] },
        expiry: NOW,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'invalid-grant' });
    expect(mocks.grantSession).not.toHaveBeenCalled();
  });

  it('rejects a session response that differs from the requested grant', async () => {
    const mocks = clientMocks(56, { grantResult: session({ walletAddress: OTHER }) });
    const adapter = new AltanaAdminAdapter({
      client: mocks.client,
      chainId: 56,
      wallet: { address: SENDER },
      signer: signer(),
    });

    await expect(
      adapter.grantRegisteredSession({
        permissions: permissions(),
        expiry: NOW + 100,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'invalid-session' });
  });

  it('revokes a registered session and requires a trackable relay hash', async () => {
    const mocks = clientMocks();
    const adapter = new AltanaAdminAdapter({
      client: mocks.client,
      chainId: 56,
      wallet: { address: SENDER },
      signer: signer(),
    });

    await expect(adapter.revokeSession(registeredSession())).resolves.toEqual({
      callsId: CALLS_ID,
      transactionHash: TRANSACTION_HASH,
      status: 'CONFIRMED',
    });
  });

  it('fails closed when revocation is reported failed', async () => {
    const mocks = clientMocks(56, {
      revokeResult: { callsId: CALLS_ID, status: 'FAILED' },
    });
    const adapter = new AltanaAdminAdapter({
      client: mocks.client,
      chainId: 56,
      wallet: { address: SENDER },
      signer: signer(),
    });

    await expect(adapter.revokeSession(registeredSession())).rejects.toMatchObject({
      code: 'relay-failed',
    });
  });

  it('submits the exact M6-approved raw call through the session', async () => {
    const mocks = clientMocks();
    const executor = new AltanaSessionExecutor({
      client: mocks.client,
      chainId: 56,
      registeredSession: registeredSession(),
    });
    const decision = await approvedDecision();
    const result = await executor.executeApproved(decision, NOW);

    expect(result).toEqual({
      submitted: true,
      checks: [],
      rejectionReasons: [],
      callsId: CALLS_ID,
      transactionHash: TRANSACTION_HASH,
      relayStatus: 'CONFIRMED',
    });
    expect(mocks.execute).toHaveBeenCalledWith({
      session: expect.objectContaining({ walletAddress: SENDER }),
      chainId: 56,
      calls: [{ to: TOKEN, value: 0n, data: transferCalldata(RECIPIENT, 20n) }],
    });
  });

  it('rejects decisions that did not pass M5 and M6', async () => {
    const mocks = clientMocks();
    const executor = new AltanaSessionExecutor({
      client: mocks.client,
      chainId: 56,
      registeredSession: registeredSession(),
    });
    const result = await executor.executeApproved({ approved: false }, NOW);
    expect(result.rejectionReasons).toEqual(['invalid-decision']);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('rejects expired sessions', async () => {
    const mocks = clientMocks();
    const executor = new AltanaSessionExecutor({
      client: mocks.client,
      chainId: 56,
      registeredSession: registeredSession({ expiry: NOW }),
    });
    expect(
      (await executor.executeApproved(await approvedDecision(), NOW)).rejectionReasons,
    ).toEqual(['session-expired']);
  });

  it('rejects chain and wallet mismatches', async () => {
    const chainMocks = clientMocks(97);
    const chainExecutor = new AltanaSessionExecutor({
      client: chainMocks.client,
      chainId: 97,
      registeredSession: registeredSession(),
    });
    expect(
      (await chainExecutor.executeApproved(await approvedDecision(), NOW)).rejectionReasons,
    ).toEqual(['session-chain-mismatch']);

    const walletMocks = clientMocks();
    const walletExecutor = new AltanaSessionExecutor({
      client: walletMocks.client,
      chainId: 56,
      registeredSession: registeredSession({ walletAddress: OTHER }),
    });
    expect(
      (await walletExecutor.executeApproved(await approvedDecision(), NOW)).rejectionReasons,
    ).toEqual(['session-wallet-mismatch']);
  });

  it('rejects calls outside the session target or selector permissions', async () => {
    const mocks = clientMocks();
    const executor = new AltanaSessionExecutor({
      client: mocks.client,
      chainId: 56,
      registeredSession: registeredSession({
        permissions: permissions({ calls: [{ to: OTHER }] }),
      }),
    });
    expect(
      (await executor.executeApproved(await approvedDecision(), NOW)).rejectionReasons,
    ).toEqual(['session-call-not-allowed']);
  });

  it('rejects token or native value outside the session spend caps', async () => {
    const tokenMocks = clientMocks();
    const tokenExecutor = new AltanaSessionExecutor({
      client: tokenMocks.client,
      chainId: 56,
      registeredSession: registeredSession({
        permissions: permissions({
          spend: [
            { limit: 1_000_000n, period: 'day' },
            { token: TOKEN, limit: 10n, period: 'day' },
          ],
        }),
      }),
    });
    expect(
      (await tokenExecutor.executeApproved(await approvedDecision(), NOW)).rejectionReasons,
    ).toEqual(['session-spend-not-allowed']);
  });

  it('rejects unavailable, failed, and malformed relay results', async () => {
    const unavailableMocks = clientMocks();
    unavailableMocks.execute.mockRejectedValueOnce(new Error('offline'));
    const unavailable = new AltanaSessionExecutor({
      client: unavailableMocks.client,
      chainId: 56,
      registeredSession: registeredSession(),
    });
    expect(
      (await unavailable.executeApproved(await approvedDecision(), NOW)).rejectionReasons,
    ).toEqual(['relay-unavailable']);

    const failedMocks = clientMocks(56, {
      executeResult: { callsId: CALLS_ID, status: 'FAILED' },
    });
    const failed = new AltanaSessionExecutor({
      client: failedMocks.client,
      chainId: 56,
      registeredSession: registeredSession(),
    });
    expect((await failed.executeApproved(await approvedDecision(), NOW)).rejectionReasons).toEqual([
      'relay-failed',
    ]);

    const malformedMocks = clientMocks(56, {
      executeResult: { callsId: CALLS_ID, status: 'CONFIRMED' },
    });
    const malformed = new AltanaSessionExecutor({
      client: malformedMocks.client,
      chainId: 56,
      registeredSession: registeredSession(),
    });
    expect(
      (await malformed.executeApproved(await approvedDecision(), NOW)).rejectionReasons,
    ).toEqual(['invalid-relay-result']);
  });
});
