import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAgentActivationMessage } from '@ambit/core';
import { privateKeyToAccount } from 'viem/accounts';
import { createApp } from '../src/index.js';
import {
  MarketplaceConflictError,
  MarketplaceUnavailableError,
  encodeCursor,
  type ExecutionHistoryItem,
  type MarketplaceAgentProfile,
  type MarketplaceRepository,
} from '../src/marketplace.js';

const REGISTRY_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = '0x1111111111111111111111111111111111111111';
const TEST_PRIVATE_KEY = '0x0123456789012345678901234567890123456789012345678901234567890123';
const REQUESTER = privateKeyToAccount(TEST_PRIVATE_KEY).address;
const DESTINATION = '0x3333333333333333333333333333333333333333';
const AGENT_REGISTRY = `eip155:56:${REGISTRY_ADDRESS}:7`;
const HIRE_TOKEN = 'test-hire-token-123456';

const execution: ExecutionHistoryItem = {
  id: 'request_1',
  clientRequestId: 'client-1',
  agentRegistry: AGENT_REGISTRY,
  requester: REQUESTER,
  destination: DESTINATION,
  protocol: 'venus',
  requestedValue: '0',
  authorizationExpiresAt: '2026-08-17T12:10:00.000Z',
  authorizationVerified: true,
  requestStatus: 'activation-confirmed',
  policyResult: 'pending',
  riskResult: null,
  simulationResult: null,
  approvalResult: 'pending',
  rejectionReason: null,
  callsId: null,
  txHash: null,
  blockNumber: null,
  blockHash: null,
  executionStatus: null,
  gas: null,
  outcome: null,
  passportId: null,
  verifiedAt: null,
  createdAt: '2026-08-17T12:00:00.000Z',
};

const profile: MarketplaceAgentProfile = {
  agentRegistry: AGENT_REGISTRY,
  agentId: '7',
  chainId: 56,
  identityRegistry: REGISTRY_ADDRESS,
  owner: OWNER,
  agentWallet: null,
  agentURI: 'ipfs://agent',
  name: 'Venus Sentinel',
  description: 'Monitors health factors.',
  image: null,
  category: 'health-factor',
  capabilities: ['monitor'],
  supportedProtocols: ['venus'],
  verificationTier: 'execution-verified',
  supportedExecution: true,
  executionVerified: true,
  verifiedActivity: true,
  trust: null,
  endpoint: null,
  lastIndexedBlock: 123,
  lastIndexedAt: '2026-08-17T12:00:00.000Z',
  metadata: null,
  reputation: [],
  activity: [],
  walletActivity: null,
  payments: [],
  policy: null,
};

function repositoryDouble() {
  return {
    ready: vi.fn<MarketplaceRepository['ready']>().mockResolvedValue(undefined),
    listAgents: vi
      .fn<MarketplaceRepository['listAgents']>()
      .mockResolvedValue({ items: [profile], nextCursor: null }),
    getAgent: vi.fn<MarketplaceRepository['getAgent']>().mockResolvedValue(profile),
    createHire: vi.fn<MarketplaceRepository['createHire']>().mockResolvedValue(execution),
    listExecutions: vi
      .fn<MarketplaceRepository['listExecutions']>()
      .mockResolvedValue({ items: [execution], nextCursor: null }),
  } satisfies MarketplaceRepository;
}

async function signedHire(overrides: Record<string, unknown> = {}) {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const activation = {
    agentRegistry: AGENT_REGISTRY,
    clientRequestId: 'client-1',
    requester: REQUESTER,
    destination: DESTINATION,
    protocol: 'venus',
    requestedValue: '0',
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
  return {
    ...activation,
    signature: await account.signMessage({ message: buildAgentActivationMessage(activation) }),
  };
}

describe('marketplace API', () => {
  let repository: ReturnType<typeof repositoryDouble>;

  beforeEach(() => {
    repository = repositoryDouble();
  });

  it('reports repository readiness separately from liveness', async () => {
    const app = createApp({ repository });
    expect(await (await app.request('/health')).json()).toEqual({
      status: 'ok',
      service: 'ambit-api',
    });
    expect(await (await app.request('/ready')).json()).toEqual({
      status: 'ok',
      service: 'ambit-api',
    });
    expect(repository.ready).toHaveBeenCalledOnce();
  });

  it('fails readiness closed when the repository is unavailable', async () => {
    repository.ready.mockRejectedValueOnce(new Error('offline'));
    const response = await createApp({ repository }).request('/ready');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'unavailable',
      service: 'ambit-api',
      error: {
        code: 'repository-unavailable',
        message: 'marketplace repository is unavailable',
      },
    });
  });

  it('lists all agents by default without hidden visibility filters', async () => {
    const response = await createApp({ repository }).request('/agents');
    expect(response.status).toBe(200);
    expect(repository.listAgents).toHaveBeenCalledWith({ limit: 20 });
    expect(await response.json()).toEqual({ items: [profile], nextCursor: null });
  });

  it('validates and forwards explicit search filters and cursors', async () => {
    const cursor = encodeCursor(AGENT_REGISTRY);
    const response = await createApp({ repository }).request(
      `/agents?q=venus&category=health-factor&verificationTier=execution-verified&supportedExecution=true&protocol=venus&minTrustScore=75&limit=10&cursor=${cursor}`,
    );
    expect(response.status).toBe(200);
    expect(repository.listAgents).toHaveBeenCalledWith({
      q: 'venus',
      category: 'health-factor',
      verificationTier: 'execution-verified',
      supportedExecution: true,
      protocol: 'venus',
      minTrustScore: 75,
      limit: 10,
      cursor: AGENT_REGISTRY,
    });
  });

  it('returns structured validation errors for invalid filters', async () => {
    const response = await createApp({ repository }).request(
      '/agents?limit=0&supportedExecution=yes&minTrustScore=101',
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid-request',
        message:
          'limit must be an integer from 1 to 100; supportedExecution must be true or false; minTrustScore must be an integer from 0 to 100',
        issues: [
          'limit must be an integer from 1 to 100',
          'supportedExecution must be true or false',
          'minTrustScore must be an integer from 0 to 100',
        ],
      },
    });
    expect(repository.listAgents).not.toHaveBeenCalled();
  });

  it('returns a profile and distinguishes an unknown agent', async () => {
    const app = createApp({ repository });
    const found = await app.request(`/agents/${AGENT_REGISTRY}`);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ agent: profile });

    repository.getAgent.mockResolvedValueOnce(null);
    const missing = await app.request(`/agents/${AGENT_REGISTRY}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: 'not-found', message: 'agent not found' },
    });
  });

  it('creates a wallet-authorized activation request and returns 202', async () => {
    const payload = await signedHire();
    const response = await createApp({ repository, hireToken: HIRE_TOKEN }).request(
      `/agents/${AGENT_REGISTRY}/hire`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${HIRE_TOKEN}` },
        body: JSON.stringify({
          ...payload,
        }),
      },
    );
    expect(response.status).toBe(202);
    const { agentRegistry: _agentRegistry, ...requestInput } = payload;
    expect(repository.createHire).toHaveBeenCalledWith(AGENT_REGISTRY, {
      ...requestInput,
    }, expect.objectContaining({ signer: REQUESTER, verifiedAt: expect.any(Date) }));
    expect(await response.json()).toEqual({ request: execution });
  });

  it.each([
    ['invalid JSON', '{', ['request body must be valid JSON']],
    [
      'invalid fields',
      JSON.stringify({
        clientRequestId: 'bad id',
        requester: '0x0',
        destination: DESTINATION,
        requestedValue: '01',
      }),
      [
        'clientRequestId contains invalid characters or is too long',
        'requester must be a non-zero address',
        'requestedValue must be a non-negative canonical decimal string',
        'expiresAt must be within the next 15 minutes',
        'signature must be a 65-byte hex value',
      ],
    ],
  ])('rejects %s for hire requests', async (_label, body, issues) => {
    const response = await createApp({ repository, hireToken: HIRE_TOKEN }).request(
      `/agents/${AGENT_REGISTRY}/hire`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${HIRE_TOKEN}` },
        body,
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'invalid-request', message: issues.join('; '), issues },
    });
    expect(repository.createHire).not.toHaveBeenCalled();
  });

  it('rejects a signature from a different requester', async () => {
    const payload = await signedHire();
    const response = await createApp({ repository, hireToken: HIRE_TOKEN }).request(
      `/agents/${AGENT_REGISTRY}/hire`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${HIRE_TOKEN}` },
        body: JSON.stringify({ ...payload, requester: DESTINATION }),
      },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.issues).toContain(
      'signature does not authorize this activation request',
    );
    expect(repository.createHire).not.toHaveBeenCalled();
  });

  it('maps conflicts and repository failures to public errors', async () => {
    const hire = {
      method: 'POST' as const,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${HIRE_TOKEN}` },
      body: JSON.stringify({
        ...(await signedHire({ protocol: undefined })),
      }),
    };
    repository.createHire.mockRejectedValueOnce(
      new MarketplaceConflictError('clientRequestId is already used'),
    );
    const conflict = await createApp({ repository, hireToken: HIRE_TOKEN }).request(
      `/agents/${AGENT_REGISTRY}/hire`,
      hire,
    );
    expect(conflict.status).toBe(409);

    repository.listAgents.mockRejectedValueOnce(
      new MarketplaceUnavailableError('marketplace database query failed'),
    );
    const unavailable = await createApp({ repository }).request('/agents');
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error: {
        code: 'repository-unavailable',
        message: 'marketplace database query failed',
      },
    });
  });

  it('lists public execution history with cursor validation', async () => {
    const cursor = encodeCursor('request_0');
    const response = await createApp({ repository }).request(
      `/agents/${AGENT_REGISTRY}/executions?limit=5&cursor=${cursor}`,
    );
    expect(response.status).toBe(200);
    expect(repository.listExecutions).toHaveBeenCalledWith(AGENT_REGISTRY, {
      limit: 5,
      cursor: 'request_0',
    });
    expect(await response.json()).toEqual({ items: [execution], nextCursor: null });
  });
});
