import { Prisma, type PrismaClient } from '@ambit/db';
import { isAddress, type Address } from 'viem';
import {
  MarketplaceConflictError,
  MarketplaceNotFoundError,
  MarketplaceUnavailableError,
  encodeCursor,
  isAgentCategory,
  isConfidence,
  isEndpointStatus,
  isVerificationTier,
  type AgentSearchQuery,
  type ExecutionHistoryItem,
  type ExecutionListQuery,
  type HireAgentInput,
  type MarketplaceAgentProfile,
  type MarketplaceAgentSummary,
  type MarketplacePolicy,
  type MarketplaceRepository,
  type MarketplaceTrust,
  type PaginatedResult,
} from './marketplace.js';

const summarySelect = Prisma.validator<Prisma.AgentSelect>()({
  agentRegistry: true,
  agentId: true,
  chainId: true,
  identityRegistry: true,
  owner: true,
  agentWallet: true,
  name: true,
  description: true,
  image: true,
  category: true,
  capabilities: true,
  supportedProtocols: true,
  verificationTier: true,
  supportedExecution: true,
  executionVerified: true,
  verifiedActivity: true,
  activityTransactionCount: true,
  activityObservedAtBlock: true,
  activityObservedAt: true,
  trustScoreValue: true,
  trustConfidence: true,
  trustMethodologyVersion: true,
  trustComputedAt: true,
  lastIndexedBlock: true,
  lastIndexedAt: true,
  endpoint: {
    orderBy: { lastChecked: 'desc' },
    take: 1,
  },
});

const profileArgs = Prisma.validator<Prisma.AgentDefaultArgs>()({
  include: {
    metadata: { orderBy: { timestamp: 'desc' }, take: 1 },
    endpoint: { orderBy: { lastChecked: 'desc' }, take: 1 },
    reputation: { orderBy: { timestamp: 'desc' }, take: 100 },
    activity: { orderBy: { timestamp: 'desc' }, take: 100 },
    payment: { orderBy: { observedAt: 'desc' }, take: 100 },
    trustScores: { orderBy: { computedAt: 'desc' }, take: 1 },
    policy: { orderBy: { createdAt: 'desc' }, take: 1 },
  },
});

const executionArgs = Prisma.validator<Prisma.ExecutionRequestDefaultArgs>()({
  include: { agent: { select: { agentRegistry: true } } },
});

type AgentSummaryRow = Prisma.AgentGetPayload<{ select: typeof summarySelect }>;
type AgentProfileRow = Prisma.AgentGetPayload<typeof profileArgs>;
type ExecutionRow = Prisma.ExecutionRequestGetPayload<typeof executionArgs>;

export function createPrismaMarketplaceRepository(client: PrismaClient): MarketplaceRepository {
  return {
    async ready(): Promise<void> {
      try {
        await client.$queryRaw(Prisma.sql`SELECT 1`);
      } catch {
        throw new MarketplaceUnavailableError('marketplace database is unavailable');
      }
    },

    async listAgents(query: AgentSearchQuery): Promise<PaginatedResult<MarketplaceAgentSummary>> {
      try {
        const rows = await client.agent.findMany({
          where: agentWhere(query),
          orderBy: [
            { trustScoreValue: { sort: 'desc', nulls: 'last' } },
            { trustConfidenceRank: 'desc' },
            { executionVerified: 'desc' },
            { name: 'asc' },
            { agentRegistry: 'asc' },
          ],
          ...(query.cursor ? { cursor: { agentRegistry: query.cursor }, skip: 1 } : {}),
          take: query.limit + 1,
          select: summarySelect,
        });
        const hasMore = rows.length > query.limit;
        const items = rows.slice(0, query.limit).map(mapSummary);
        return {
          items,
          nextCursor:
            hasMore && items.length > 0 ? encodeCursor(items.at(-1)!.agentRegistry) : null,
        };
      } catch (error) {
        throw unavailable(error);
      }
    },

    async getAgent(agentRegistry: string): Promise<MarketplaceAgentProfile | null> {
      try {
        const row = await client.agent.findUnique({
          where: { agentRegistry },
          ...profileArgs,
        });
        return row ? mapProfile(row) : null;
      } catch (error) {
        throw unavailable(error);
      }
    },

    async createHire(agentRegistry: string, input: HireAgentInput): Promise<ExecutionHistoryItem> {
      try {
        const agent = await client.agent.findUnique({
          where: { agentRegistry },
          select: { id: true, agentRegistry: true },
        });
        if (!agent) throw new MarketplaceNotFoundError('agent not found');

        const existing = await client.executionRequest.findUnique({
          where: { clientRequestId: input.clientRequestId },
          ...executionArgs,
        });
        if (existing) {
          if (!sameHire(existing, agent.id, input)) {
            throw new MarketplaceConflictError('clientRequestId is already used');
          }
          return mapExecution(existing);
        }

        const created = await client.executionRequest.create({
          data: {
            agentId: agent.id,
            clientRequestId: input.clientRequestId,
            requester: input.requester,
            destination: input.destination,
            ...(input.protocol ? { protocol: input.protocol } : {}),
            requestedValue: input.requestedValue,
            requestStatus: 'activation-confirmed',
          },
          ...executionArgs,
        });
        return mapExecution(created);
      } catch (error) {
        if (
          error instanceof MarketplaceNotFoundError ||
          error instanceof MarketplaceConflictError ||
          error instanceof MarketplaceUnavailableError
        ) {
          throw error;
        }
        if (isUniqueConstraintError(error)) {
          throw new MarketplaceConflictError('clientRequestId is already used');
        }
        throw unavailable(error);
      }
    },

    async listExecutions(
      agentRegistry: string,
      query: ExecutionListQuery,
    ): Promise<PaginatedResult<ExecutionHistoryItem>> {
      try {
        const agent = await client.agent.findUnique({
          where: { agentRegistry },
          select: { id: true },
        });
        if (!agent) throw new MarketplaceNotFoundError('agent not found');

        const rows = await client.executionRequest.findMany({
          where: { agentId: agent.id },
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
          take: query.limit + 1,
          ...executionArgs,
        });
        const hasMore = rows.length > query.limit;
        const items = rows.slice(0, query.limit).map(mapExecution);
        return {
          items,
          nextCursor: hasMore && items.length > 0 ? encodeCursor(items.at(-1)!.id) : null,
        };
      } catch (error) {
        if (error instanceof MarketplaceNotFoundError) throw error;
        throw unavailable(error);
      }
    },
  };
}

function agentWhere(query: AgentSearchQuery): Prisma.AgentWhereInput {
  const filters: Prisma.AgentWhereInput[] = [];
  if (query.q) {
    filters.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { description: { contains: query.q, mode: 'insensitive' } },
        { capabilities: { has: query.q } },
        { supportedProtocols: { has: query.q } },
      ],
    });
  }
  if (query.category) filters.push({ category: query.category });
  if (query.verificationTier) filters.push({ verificationTier: query.verificationTier });
  if (query.supportedExecution !== undefined) {
    filters.push({ supportedExecution: query.supportedExecution });
  }
  if (query.protocol) filters.push({ supportedProtocols: { has: query.protocol } });
  if (query.minTrustScore !== undefined) {
    filters.push({ trustScoreValue: { gte: query.minTrustScore } });
  }
  return filters.length > 0 ? { AND: filters } : {};
}

function mapSummary(row: AgentSummaryRow): MarketplaceAgentSummary {
  const identityRegistry = requireAddress(row.identityRegistry, 'identity registry');
  const owner = requireAddress(row.owner, 'owner');
  const agentWallet = row.agentWallet ? requireAddress(row.agentWallet, 'agent wallet') : null;
  const verificationTier = isVerificationTier(row.verificationTier)
    ? row.verificationTier
    : 'unverified';
  const category = isAgentCategory(row.category) ? row.category : null;
  const endpoint = row.endpoint[0];

  return {
    agentRegistry: row.agentRegistry,
    agentId: row.agentId,
    chainId: row.chainId,
    identityRegistry,
    owner,
    agentWallet,
    name: row.name,
    description: row.description,
    image: row.image,
    category,
    capabilities: row.capabilities,
    supportedProtocols: row.supportedProtocols,
    verificationTier,
    supportedExecution: row.supportedExecution,
    executionVerified: row.executionVerified,
    verifiedActivity: row.verifiedActivity,
    trust: currentTrust(row),
    endpoint:
      endpoint && isEndpointStatus(endpoint.status)
        ? {
            url: endpoint.url,
            status: endpoint.status,
            lastChecked: iso(endpoint.lastChecked),
            latencyMs: endpoint.latencyMs,
          }
        : null,
    lastIndexedBlock: row.lastIndexedBlock,
    lastIndexedAt: iso(row.lastIndexedAt),
  };
}

function mapProfile(row: AgentProfileRow): MarketplaceAgentProfile {
  const summary = mapSummary(row);
  const metadata = row.metadata[0];
  const policy = row.policy[0];
  const historicalTrust = row.trustScores[0];
  const trust = historicalTrust ? mapHistoricalTrust(historicalTrust) : summary.trust;

  return {
    ...summary,
    trust,
    agentURI: row.agentURI,
    metadata: metadata
      ? {
          source: metadata.source,
          blockNumber: metadata.blockNumber,
          txHash: metadata.txHash,
          timestamp: metadata.timestamp.toISOString(),
        }
      : null,
    reputation: row.reputation.map((event) => ({
      clientAddress: requireAddress(event.clientAddress, 'reputation client'),
      value: event.value,
      valueDecimals: event.valueDecimals,
      tag1: event.tag1,
      tag2: event.tag2,
      blockNumber: event.blockNumber,
      txHash: event.txHash,
      timestamp: event.timestamp.toISOString(),
    })),
    activity: row.activity.map((event) => ({
      kind: event.kind,
      blockNumber: event.blockNumber,
      txHash: event.txHash,
      timestamp: event.timestamp.toISOString(),
    })),
    payments: row.payment.map((evidence) => ({
      source: evidence.source,
      linkedTxHash: evidence.linkedTxHash,
      chainId: evidence.chainId,
      reliable: evidence.reliable,
      observedAt: evidence.observedAt.toISOString(),
    })),
    walletActivity:
      row.activityTransactionCount !== null &&
      row.activityTransactionCount !== undefined &&
      row.activityObservedAtBlock !== null &&
      row.activityObservedAtBlock !== undefined &&
      row.activityObservedAt !== null &&
      row.activityObservedAt !== undefined
        ? {
            transactionCount: row.activityTransactionCount,
            observedAtBlock: row.activityObservedAtBlock,
            observedAt: row.activityObservedAt.toISOString(),
          }
        : null,
    policy: policy ? mapPolicy(policy) : null,
  };
}

function currentTrust(row: AgentSummaryRow): MarketplaceTrust | null {
  if (
    row.trustScoreValue === null ||
    !isConfidence(row.trustConfidence) ||
    !row.trustMethodologyVersion ||
    !row.trustComputedAt
  ) {
    return null;
  }
  return {
    score: row.trustScoreValue,
    confidence: row.trustConfidence,
    methodologyVersion: row.trustMethodologyVersion,
    computedAt: row.trustComputedAt.toISOString(),
    evidence: [],
  };
}

function mapHistoricalTrust(row: AgentProfileRow['trustScores'][number]): MarketplaceTrust | null {
  if (!isConfidence(row.confidence)) return null;
  return {
    score: row.score,
    confidence: row.confidence,
    methodologyVersion: row.methodologyVersion,
    computedAt: row.computedAt.toISOString(),
    evidence: parseEvidence(row.evidence),
  };
}

function mapPolicy(row: AgentProfileRow['policy'][number]): MarketplacePolicy {
  return {
    maxTxValue: row.maxTxValue,
    dailySpend: row.dailySpend,
    allowedTokens: row.allowedTokens.map((address) => requireAddress(address, 'allowed token')),
    allowedProtocols: row.allowedProtocols,
    allowedTargets: row.allowedTargets.map((address) => requireAddress(address, 'allowed target')),
    expiry: iso(row.expiry),
    maxSlippageBps: row.maxSlippageBps,
    minHealthFactor: row.minHealthFactor,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapExecution(row: ExecutionRow): ExecutionHistoryItem {
  return {
    id: row.id,
    clientRequestId: row.clientRequestId,
    agentRegistry: row.agent.agentRegistry,
    requester: row.requester ? requireAddress(row.requester, 'requester') : null,
    destination: requireAddress(row.destination, 'destination'),
    protocol: row.protocol,
    requestedValue: row.requestedValue,
    requestStatus: row.requestStatus,
    policyResult: row.policyResult,
    riskResult: row.riskResult,
    simulationResult: row.simulationResult,
    approvalResult: row.approvalRejection,
    rejectionReason: row.rejectionReason,
    callsId: row.callsId,
    txHash: row.txHash,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    executionStatus: row.executionStatus,
    gas: row.gas,
    outcome: row.outcome,
    passportId: row.passportId,
    verifiedAt: iso(row.verifiedAt),
    createdAt: row.timestamp.toISOString(),
  };
}

function sameHire(row: ExecutionRow, agentId: string, input: HireAgentInput): boolean {
  return (
    row.agentId === agentId &&
    row.requester?.toLowerCase() === input.requester.toLowerCase() &&
    row.destination.toLowerCase() === input.destination.toLowerCase() &&
    row.protocol === (input.protocol ?? null) &&
    row.requestedValue === input.requestedValue
  );
}

function parseEvidence(value: string): MarketplaceTrust['evidence'] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEvidence);
  } catch {
    return [];
  }
}

function isEvidence(value: unknown): value is MarketplaceTrust['evidence'][number] {
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.timestamp !== 'string') {
    return false;
  }
  return (
    (value.blockNumber === undefined || Number.isSafeInteger(value.blockNumber)) &&
    (value.txHash === undefined || typeof value.txHash === 'string') &&
    (value.methodologyVersion === undefined || typeof value.methodologyVersion === 'string')
  );
}

function requireAddress(value: string, label: string): Address {
  if (!isAddress(value) || /^0x0{40}$/u.test(value)) {
    throw new MarketplaceUnavailableError(`stored ${label} address is invalid`);
  }
  return value;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function unavailable(error: unknown): MarketplaceUnavailableError {
  return error instanceof MarketplaceUnavailableError
    ? error
    : new MarketplaceUnavailableError('marketplace database query failed');
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
