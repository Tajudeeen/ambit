import type { PrismaClient } from '@ambit/db';
import { describe, expect, it, vi } from 'vitest';
import { MarketplaceConflictError } from '../src/marketplace.js';
import { createPrismaMarketplaceRepository } from '../src/prisma-repository.js';

const REGISTRY_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = '0x1111111111111111111111111111111111111111';
const REQUESTER = '0x2222222222222222222222222222222222222222';
const DESTINATION = '0x3333333333333333333333333333333333333333';
const SIGNATURE = `0x${'11'.repeat(65)}`;
const AGENT_REGISTRY = `eip155:56:${REGISTRY_ADDRESS}:7`;
const NOW = new Date('2026-08-17T12:00:00.000Z');

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent_1',
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
    trustScoreValue: 91,
    trustConfidence: 'high',
    trustConfidenceRank: 3,
    trustMethodologyVersion: 'm4-v1',
    trustComputedAt: NOW,
    lastIndexedBlock: 123,
    lastIndexedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    endpoint: [
      {
        id: 'endpoint_1',
        agentId: 'agent_1',
        url: 'https://agent.example',
        status: 'up',
        lastChecked: NOW,
        latencyMs: 42,
      },
    ],
    ...overrides,
  };
}

function executionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'request_1',
    agentId: 'agent_1',
    clientRequestId: 'client-1',
    requester: REQUESTER,
    sessionId: 'private-session',
    destination: DESTINATION,
    calldata: '0xdeadbeef',
    protocol: 'venus',
    requestedValue: '0',
    requestStatus: 'activation-confirmed',
    policyResult: 'pending',
    riskResult: null,
    simulationResult: null,
    approvalRejection: 'pending',
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
    timestamp: NOW,
    agent: { agentRegistry: AGENT_REGISTRY },
    ...overrides,
  };
}

function prismaDouble() {
  const queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
  const agentFindMany = vi.fn();
  const agentFindUnique = vi.fn();
  const executionFindUnique = vi.fn();
  const executionCreate = vi.fn();
  const executionFindMany = vi.fn();
  const client = {
    $queryRaw: queryRaw,
    agent: { findMany: agentFindMany, findUnique: agentFindUnique },
    executionRequest: {
      findUnique: executionFindUnique,
      create: executionCreate,
      findMany: executionFindMany,
    },
  } as unknown as PrismaClient;
  return {
    client,
    queryRaw,
    agentFindMany,
    agentFindUnique,
    executionFindUnique,
    executionCreate,
    executionFindMany,
  };
}

describe('Prisma marketplace repository', () => {
  it('uses deterministic ranking, explicit filters, and cursor pagination', async () => {
    const db = prismaDouble();
    db.agentFindMany.mockResolvedValue([
      agentRow(),
      agentRow({ agentRegistry: `eip155:56:${REGISTRY_ADDRESS}:8`, agentId: '8' }),
    ]);
    const repository = createPrismaMarketplaceRepository(db.client);

    const result = await repository.listAgents({
      q: 'venus',
      category: 'health-factor',
      verificationTier: 'execution-verified',
      supportedExecution: true,
      protocol: 'venus',
      minTrustScore: 80,
      cursor: AGENT_REGISTRY,
      limit: 1,
    });

    expect(db.agentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { name: { contains: 'venus', mode: 'insensitive' } },
                { description: { contains: 'venus', mode: 'insensitive' } },
                { capabilities: { has: 'venus' } },
                { supportedProtocols: { has: 'venus' } },
              ],
            },
            { category: 'health-factor' },
            { verificationTier: 'execution-verified' },
            { supportedExecution: true },
            { supportedProtocols: { has: 'venus' } },
            { trustScoreValue: { gte: 80 } },
          ],
        },
        orderBy: [
          { trustScoreValue: { sort: 'desc', nulls: 'last' } },
          { trustConfidenceRank: 'desc' },
          { executionVerified: 'desc' },
          { name: 'asc' },
          { agentRegistry: 'asc' },
        ],
        cursor: { agentRegistry: AGENT_REGISTRY },
        skip: 1,
        take: 2,
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      agentRegistry: AGENT_REGISTRY,
      trust: { score: 91, confidence: 'high', methodologyVersion: 'm4-v1' },
      endpoint: { status: 'up', latencyMs: 42 },
    });
    expect(result.nextCursor).toBeTruthy();
  });

  it('maps the latest profile evidence and historical trust details', async () => {
    const db = prismaDouble();
    db.agentFindUnique.mockResolvedValue(
      agentRow({
        metadata: [
          {
            id: 'metadata_1',
            agentId: 'agent_1',
            data: '{}',
            source: 'erc8004',
            blockNumber: 120,
            txHash: '0xmetadata',
            timestamp: NOW,
          },
        ],
        reputation: [],
        activity: [],
        payment: [],
        trustScores: [
          {
            id: 'trust_1',
            agentId: 'agent_1',
            score: 92,
            confidence: 'high',
            methodologyVersion: 'm4-v2',
            evidence: JSON.stringify([{ source: 'reputation', timestamp: NOW.toISOString() }]),
            computedAt: NOW,
          },
        ],
        policy: [
          {
            id: 'policy_1',
            agentId: 'agent_1',
            maxTxValue: '100',
            dailySpend: '500',
            allowedTokens: [DESTINATION],
            allowedProtocols: ['venus'],
            allowedTargets: [DESTINATION],
            expiry: null,
            maxSlippageBps: 50,
            minHealthFactor: '1.2',
            createdAt: NOW,
          },
        ],
      }),
    );
    const repository = createPrismaMarketplaceRepository(db.client);

    const result = await repository.getAgent(AGENT_REGISTRY);

    expect(db.agentFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agentRegistry: AGENT_REGISTRY },
        include: expect.objectContaining({
          metadata: { orderBy: { timestamp: 'desc' }, take: 1 },
          trustScores: { orderBy: { computedAt: 'desc' }, take: 1 },
          policy: { orderBy: { createdAt: 'desc' }, take: 1 },
        }),
      }),
    );
    expect(result).toMatchObject({
      metadata: { source: 'erc8004', blockNumber: 120 },
      trust: {
        score: 92,
        confidence: 'high',
        methodologyVersion: 'm4-v2',
        evidence: [{ source: 'reputation', timestamp: NOW.toISOString() }],
      },
      policy: {
        maxTxValue: '100',
        allowedProtocols: ['venus'],
        allowedTargets: [DESTINATION],
      },
    });
  });

  it('creates an activation-confirmed hire with server-owned decision state', async () => {
    const db = prismaDouble();
    db.agentFindUnique.mockResolvedValue({ id: 'agent_1', agentRegistry: AGENT_REGISTRY });
    db.executionFindUnique.mockResolvedValue(null);
    db.executionCreate.mockResolvedValue(executionRow());
    const repository = createPrismaMarketplaceRepository(db.client);

    const result = await repository.createHire(AGENT_REGISTRY, {
      clientRequestId: 'client-1',
      requester: REQUESTER,
      destination: DESTINATION,
      protocol: 'venus',
      requestedValue: '0',
      expiresAt: 1_800_000_600,
      signature: SIGNATURE,
    });

    expect(db.executionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          agentId: 'agent_1',
          clientRequestId: 'client-1',
          requester: REQUESTER,
          destination: DESTINATION,
          protocol: 'venus',
          requestedValue: '0',
          requestStatus: 'activation-confirmed',
        },
      }),
    );
    expect(result).toMatchObject({
      requestStatus: 'activation-confirmed',
      policyResult: 'pending',
      approvalResult: 'pending',
    });
  });

  it('returns an idempotent hire and rejects conflicting request reuse', async () => {
    const db = prismaDouble();
    db.agentFindUnique.mockResolvedValue({ id: 'agent_1', agentRegistry: AGENT_REGISTRY });
    db.executionFindUnique.mockResolvedValue(executionRow());
    const repository = createPrismaMarketplaceRepository(db.client);
    const input = {
      clientRequestId: 'client-1',
      requester: REQUESTER,
      destination: DESTINATION,
      protocol: 'venus',
      requestedValue: '0',
      expiresAt: 1_800_000_600,
      signature: SIGNATURE,
    } as const;

    await expect(repository.createHire(AGENT_REGISTRY, input)).resolves.toMatchObject({
      id: 'request_1',
    });
    expect(db.executionCreate).not.toHaveBeenCalled();

    db.executionFindUnique.mockResolvedValueOnce(executionRow({ requestedValue: '1' }));
    await expect(repository.createHire(AGENT_REGISTRY, input)).rejects.toBeInstanceOf(
      MarketplaceConflictError,
    );
  });

  it('paginates execution history without exposing sessions or calldata', async () => {
    const db = prismaDouble();
    db.agentFindUnique.mockResolvedValue({ id: 'agent_1' });
    db.executionFindMany.mockResolvedValue([
      executionRow(),
      executionRow({ id: 'request_0', clientRequestId: 'client-0' }),
    ]);
    const repository = createPrismaMarketplaceRepository(db.client);

    const result = await repository.listExecutions(AGENT_REGISTRY, {
      cursor: 'request_previous',
      limit: 1,
    });

    expect(db.executionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agentId: 'agent_1' },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        cursor: { id: 'request_previous' },
        skip: 1,
        take: 2,
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeTruthy();
    expect(result.items[0]).not.toHaveProperty('sessionId');
    expect(result.items[0]).not.toHaveProperty('calldata');
  });

  it('checks database readiness without an RPC dependency', async () => {
    const db = prismaDouble();
    await expect(createPrismaMarketplaceRepository(db.client).ready()).resolves.toBeUndefined();
    expect(db.queryRaw).toHaveBeenCalledOnce();
  });
});
