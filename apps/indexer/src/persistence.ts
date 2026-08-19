import type { Agent, Confidence } from '@ambit/core';
import type { NewFeedbackEvent, RegisteredEvent } from '@ambit/erc8004';
import type { PrismaClient } from '@ambit/db';

export interface IndexedAgentContext {
  rawMetadataJson: string;
  feedbackEvents: readonly NewFeedbackEvent[];
}

export async function persistIndexedAgent(
  client: PrismaClient,
  agent: Agent,
  event: RegisteredEvent,
  context: IndexedAgentContext,
): Promise<void> {
  const indexedAt = requiredDate(agent.lastIndexedAt, 'lastIndexedAt');
  const activityObservedAt = agent.activity ? new Date(agent.activity.observedAt) : null;
  const stored = await client.agent.upsert({
    where: { agentRegistry: agent.agentRegistry },
    create: {
      id: agent.agentRegistry,
      agentRegistry: agent.agentRegistry,
      agentId: agent.agentId,
      chainId: agent.chainId,
      identityRegistry: agent.identityRegistry,
      owner: agent.owner,
      agentWallet: agent.agentWallet,
      agentURI: agent.agentURI,
      name: agent.name,
      description: agent.description,
      image: agent.image ?? null,
      category: agent.category,
      capabilities: agent.capabilities,
      supportedProtocols: agent.supportedProtocols,
      verificationTier: agent.verificationTier,
      supportedExecution: agent.supportedExecution,
      executionVerified: agent.executionVerified,
      verifiedActivity: agent.verifiedActivity,
      activityTransactionCount: agent.activity?.transactionCount ?? null,
      activityObservedAtBlock: agent.activity?.observedAtBlock ?? null,
      activityObservedAt,
      trustScoreValue: agent.trust?.score ?? null,
      trustConfidence: agent.trust?.confidence ?? 'none',
      trustConfidenceRank: confidenceRank(agent.trust?.confidence ?? 'none'),
      trustMethodologyVersion: agent.trust?.methodologyVersion ?? null,
      trustComputedAt: agent.trust ? indexedAt : null,
      lastIndexedBlock: agent.lastIndexedBlock,
      lastIndexedAt: indexedAt,
    },
    update: {
      owner: agent.owner,
      agentWallet: agent.agentWallet,
      agentURI: agent.agentURI,
      name: agent.name,
      description: agent.description,
      image: agent.image ?? null,
      category: agent.category,
      capabilities: agent.capabilities,
      supportedProtocols: agent.supportedProtocols,
      verificationTier: agent.verificationTier,
      supportedExecution: agent.supportedExecution,
      executionVerified: agent.executionVerified,
      verifiedActivity: agent.verifiedActivity,
      activityTransactionCount: agent.activity?.transactionCount ?? null,
      activityObservedAtBlock: agent.activity?.observedAtBlock ?? null,
      activityObservedAt,
      trustScoreValue: agent.trust?.score ?? null,
      trustConfidence: agent.trust?.confidence ?? 'none',
      trustConfidenceRank: confidenceRank(agent.trust?.confidence ?? 'none'),
      trustMethodologyVersion: agent.trust?.methodologyVersion ?? null,
      trustComputedAt: agent.trust ? indexedAt : null,
      lastIndexedBlock: agent.lastIndexedBlock,
      lastIndexedAt: indexedAt,
    },
    select: { id: true },
  });

  await client.agentMetadata.upsert({
    where: {
      agentId_source_txHash: {
        agentId: stored.id,
        source: 'erc8004-registration',
        txHash: event.txHash,
      },
    },
    create: {
      agentId: stored.id,
      data: context.rawMetadataJson,
      source: 'erc8004-registration',
      blockNumber: Number(event.blockNumber),
      txHash: event.txHash,
      timestamp: indexedAt,
    },
    update: {
      data: context.rawMetadataJson,
      blockNumber: Number(event.blockNumber),
      timestamp: indexedAt,
    },
  });

  if (agent.endpoint) {
    await client.agentEndpoint.upsert({
      where: { agentId_url: { agentId: stored.id, url: agent.endpoint.url } },
      create: {
        agentId: stored.id,
        url: agent.endpoint.url,
        status: agent.endpoint.status,
        lastChecked: new Date(agent.endpoint.lastChecked),
        latencyMs: agent.endpoint.latencyMs ?? null,
      },
      update: {
        status: agent.endpoint.status,
        lastChecked: new Date(agent.endpoint.lastChecked),
        latencyMs: agent.endpoint.latencyMs ?? null,
      },
    });
  }

  for (const feedback of context.feedbackEvents) {
    await client.reputationEvent.upsert({
      where: { txHash_logIndex: { txHash: feedback.txHash, logIndex: feedback.logIndex } },
      create: {
        agentId: stored.id,
        clientAddress: feedback.clientAddress,
        value: feedback.value.toString(),
        valueDecimals: feedback.valueDecimals,
        tag1: feedback.tag1,
        tag2: feedback.tag2,
        endpoint: feedback.endpoint,
        feedbackURI: feedback.feedbackURI,
        feedbackHash: feedback.feedbackHash,
        blockNumber: Number(feedback.blockNumber),
        txHash: feedback.txHash,
        logIndex: feedback.logIndex,
        timestamp: indexedAt,
      },
      update: {},
    });
  }

  if (agent.trust) {
    await client.trustScore.deleteMany({
      where: { agentId: stored.id, methodologyVersion: agent.trust.methodologyVersion },
    });
    await client.trustScore.create({
      data: {
        agentId: stored.id,
        score: agent.trust.score,
        confidence: agent.trust.confidence,
        methodologyVersion: agent.trust.methodologyVersion,
        evidence: JSON.stringify(agent.trust.evidence),
        computedAt: indexedAt,
      },
    });
  }
}

function confidenceRank(confidence: Confidence): number {
  return confidence === 'high' ? 3 : confidence === 'medium' ? 2 : confidence === 'low' ? 1 : 0;
}

function requiredDate(value: string | null, field: string): Date {
  if (!value) throw new Error(`${field} is required for persistence`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is invalid`);
  return date;
}
