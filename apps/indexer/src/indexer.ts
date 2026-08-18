import {
  Erc8004Reader,
  getNetwork,
  resolveAgentURI,
  validateRegistrationFile,
  type RegisteredEvent,
  type NewFeedbackEvent,
} from '@ambit/erc8004';
import { createBscClient } from '@ambit/erc8004';
import {
  METHODOLOGY_VERSION,
  classifyAgentCategory,
  type Agent,
  type Evidence,
  type EndpointStatus,
} from '@ambit/core';
import { probeEndpoint, type ProbeResult } from '@ambit/endpoint';
import { normalizeFeedback, summarizeReputation } from '@ambit/reputation';
import { scoreAgent, withTrust } from '@ambit/trust-engine';
import { verifyActivity, type ActivityClient } from '@ambit/activity';

import { getConfig } from '@ambit/config';
import { MemoryCheckpointStore, nextStartBlock, type CheckpointStore } from './checkpoint.js';

export interface IndexerDeps {
  rpcUrl: string;
  chainId: number;
  checkpoint: CheckpointStore;
  /** Cap on blocks scanned per run (avoid hammering RPC / huge responses). */
  batchSize: number;
  /** Stop once we reach this block (default: current head). */
  toBlock?: number;
  /** Optional progress sink (used by tests + observability). */
  onAgent?: (agent: Agent, ev: RegisteredEvent) => void;
  /** Optional sink for unresolved URIs (so we never silently drop data). */
  onUnresolved?: (ev: RegisteredEvent, reason: string) => void;
  fetchImpl?: typeof fetch;
  /** Override endpoint prober (tests inject a fake). */
  probeImpl?: (url: string) => Promise<ProbeResult>;
  /** Override reputation events source (tests inject fixtures). */
  feedbackSource?: (from: bigint, to: bigint) => Promise<NewFeedbackEvent[]>;
  /** Override on-chain activity verifier (tests inject a fake). */
  activityClient?: ActivityClient;
}

/**
 * M2 enrichment: from a Registered event + resolved metadata JSON, build the
 * canonical Agent seed AND validate the metadata + resolve the endpoint.
 *
 * - Malformed metadata is recorded, never fabricated (agent stays discoverable
 *   with a `metadataValid: false` flag — R-VIS: trust never gates visibility).
 * - Endpoint is probed through the SSRF-safe verifier; failures are recorded as
 *   evidence, not hidden.
 */
export function eventToAgent(
  ev: RegisteredEvent,
  net: ReturnType<typeof getNetwork>,
  rawMetadataJson: string,
  resolvedAt: string,
  probe: ProbeResult | null,
  agentWallet: string | null = null,
): Agent {
  const valid = validateRegistrationFile(safeParse(rawMetadataJson));
  const reg = valid.ok ? valid.data : null;
  const raw = safeParse(rawMetadataJson) as { name?: string; description?: string } | null;
  const name = reg?.name ?? raw?.name ?? `Agent ${ev.agentId}`;
  const description = reg?.description ?? raw?.description ?? '';
  const capabilities = (reg?.services ?? []).map((s) => s.name ?? '').filter(Boolean);
  const categoryClassification = reg ? classifyAgentCategory(reg) : null;
  const epUrl = firstEndpoint(rawMetadataJson); // lenient: endpoint even if other fields invalid

  let endpoint: Agent['endpoint'] = null;
  if (epUrl) {
    const status: EndpointStatus = probe
      ? probe.status === 'blocked'
        ? 'down'
        : probe.status
      : 'unknown';
    endpoint = { url: epUrl, status, lastChecked: resolvedAt, latencyMs: probe?.latencyMs };
  }

  const evidence: Evidence[] = [
    {
      source: 'erc8004-identity',
      timestamp: resolvedAt,
      blockNumber: Number(ev.blockNumber),
      txHash: ev.txHash,
      methodologyVersion: 'v0.0.0',
    },
  ];
  if (!valid.ok) {
    evidence.push({
      source: 'metadata-validation',
      timestamp: resolvedAt,
      methodologyVersion: 'v0.0.0',
    });
  }
  if (categoryClassification?.status === 'classified') {
    evidence.push({
      source: 'metadata-category-classification',
      timestamp: resolvedAt,
      blockNumber: Number(ev.blockNumber),
      txHash: ev.txHash,
      methodologyVersion: categoryClassification.methodologyVersion,
    });
  }
  if (categoryClassification?.status === 'ambiguous') {
    evidence.push({
      source: 'metadata-category-ambiguous',
      timestamp: resolvedAt,
      blockNumber: Number(ev.blockNumber),
      txHash: ev.txHash,
      methodologyVersion: categoryClassification.methodologyVersion,
    });
  }
  if (probe && probe.status === 'blocked') {
    evidence.push({
      source: 'endpoint-ssrf-blocked',
      timestamp: resolvedAt,
      methodologyVersion: 'v0.0.0',
    });
  }

  const agentRegistry = `eip155:${net.chainId}:${net.identityRegistry}:${ev.agentId}`;
  return {
    agentRegistry,
    agentId: ev.agentId.toString(),
    chainId: net.chainId,
    identityRegistry: net.identityRegistry,
    owner: ev.owner,
    agentWallet,
    agentURI: ev.agentURI,
    name,
    description,
    category: categoryClassification?.category ?? null,
    capabilities,
    endpoint,
    reputation: null, // filled by ingestReputation
    paymentEvidence: [],
    activity: null,
    verifiedActivity: false,
    trust: null,
    verificationTier: 'unverified',
    supportedExecution: false,
    supportedProtocols: [],
    executionVerified: false,
    executionStats: {
      verifiedExecutions: 0,
      blockedActions: 0,
      successRate: null,
      capitalProcessed: '0',
    },
    policy: null,
    evidenceRefs: evidence,
    lastIndexedBlock: Number(ev.blockNumber),
    lastIndexedAt: resolvedAt,
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Ingest reputation for the agents discovered in this range. Reads NewFeedback
 * events, normalizes, and attaches a ReputationSummary + Sybil concentration to
 * each agent. Returns a map agentId -> ReputationSummary. (M3 turns this into a
 * Trust Score; here we only normalize + label quality.)
 */
export function buildReputationMap(
  feedback: NewFeedbackEvent[],
  nowIso: string,
): Map<string, ReturnType<typeof summarizeReputation>> {
  const norm = normalizeFeedback(feedback);
  const byAgent = new Map<string, typeof norm>();
  for (const f of norm) {
    const arr = byAgent.get(f.agentId) ?? [];
    arr.push(f);
    byAgent.set(f.agentId, arr);
  }
  const out = new Map<string, ReturnType<typeof summarizeReputation>>();
  for (const [agentId, evts] of byAgent) {
    out.set(agentId, summarizeReputation(evts, nowIso));
  }
  return out;
}

/**
 * One deterministic indexing pass: query [start, toBlock], dedupe by
 * (txHash,logIndex), resolve + validate metadata, probe endpoints (SSRF-safe),
 * ingest reputation, emit agents. Returns the block reached.
 *
 * Idempotent: re-running with the same checkpoint range produces the same
 * agents (resolution + normalization are pure given the same chain state).
 */
export async function indexOnce(deps: IndexerDeps): Promise<{ toBlock: number; agents: number }> {
  const net = getNetwork(deps.chainId);
  const client = createBscClient(deps.rpcUrl, deps.chainId === 97);
  const reader = new Erc8004Reader(client, net);
  const probe = deps.probeImpl ?? ((url: string) => probeEndpoint(url));
  const feedbackSrc = deps.feedbackSource ?? ((from, to) => reader.getNewFeedbackEvents(from, to));
  const activityClient: ActivityClient = deps.activityClient ?? {
    getTransactionCount: ({ address, blockNumber }) =>
      client.getTransactionCount({ address, blockNumber }),
  };

  const cp = await deps.checkpoint.get(deps.chainId, net.identityRegistry);
  const start: bigint = BigInt(nextStartBlock(net, net.identityRegistry, cp));
  const head: bigint = deps.toBlock != null ? BigInt(deps.toBlock) : await client.getBlockNumber();
  if (head < start) {
    return { toBlock: Number(start - 1n), agents: 0 };
  }
  const end: bigint = head < start ? start : head;
  const batchEnd: bigint =
    end < start + BigInt(deps.batchSize) - 1n ? end : start + BigInt(deps.batchSize) - 1n;

  let count = 0;
  if (batchEnd >= start) {
    const events = await reader.getRegisteredEvents(start, batchEnd);
    const feedback = await feedbackSrc(start, batchEnd);
    const repMap = buildReputationMap(feedback, new Date().toISOString());
    const observedAtBlock = head;

    for (const ev of events) {
      try {
        const observedAt = new Date().toISOString();
        const raw = await resolveAgentURI(ev.agentURI, deps.fetchImpl);
        const epUrl = firstEndpoint(raw);
        const probeRes = epUrl ? await probe(epUrl) : null;
        const wallet = await reader.getAgentWallet(ev.agentId, observedAtBlock);
        const agent = eventToAgent(ev, net, raw, observedAt, probeRes, wallet);
        const rep = repMap.get(ev.agentId.toString());
        if (rep) agent.reputation = rep;
        if (wallet) {
          agent.evidenceRefs.push({
            source: 'erc8004-agent-wallet',
            timestamp: observedAt,
            blockNumber: Number(observedAtBlock),
            methodologyVersion: METHODOLOGY_VERSION,
          });
          try {
            const activity = await verifyActivity(activityClient, {
              wallet,
              observedAtBlock,
              observedAt,
            });
            agent.activity = {
              transactionCount: activity.transactionCount,
              observedAtBlock: Number(activity.observedAtBlock),
              observedAt: activity.observedAt,
            };
            agent.verifiedActivity = activity.verifiedActivity;
            agent.evidenceRefs.push(...activity.evidence);
          } catch {
            agent.evidenceRefs.push({
              source: 'onchain-activity-unavailable',
              timestamp: observedAt,
              blockNumber: Number(observedAtBlock),
              methodologyVersion: METHODOLOGY_VERSION,
            });
          }
        }
        const scored = withTrust(agent, scoreAgent(agent));
        deps.onAgent?.(scored, ev);
        count++;
      } catch (e) {
        deps.onUnresolved?.(ev, e instanceof Error ? e.message : String(e));
      }
    }
  }

  await deps.checkpoint.save(deps.chainId, net.identityRegistry, Number(batchEnd));
  return { toBlock: Number(batchEnd), agents: count };
}

/** Extract the first service endpoint from raw metadata (validation not required here). */
function firstEndpoint(raw: string): string | null {
  const p = safeParse(raw);
  if (
    p &&
    typeof p === 'object' &&
    'services' in p &&
    Array.isArray((p as { services: unknown[] }).services)
  ) {
    const s = (p as { services: Array<{ endpoint?: string }> }).services[0];
    return s?.endpoint ?? null;
  }
  return null;
}

/** CLI entrypoint: run a single pass and exit (no DB write yet — M2 persists). */
export async function main(): Promise<void> {
  const cfg = getConfig();
  const store = new MemoryCheckpointStore();
  console.log(`[ambit-indexer] M2 — indexing BSC ERC-8004 (identity + metadata + reputation)`);
  const { toBlock, agents } = await indexOnce({
    rpcUrl: cfg.bsc.rpcUrl,
    chainId: cfg.bsc.chainId,
    checkpoint: store,
    batchSize: cfg.indexer.batchSize,
    onAgent: (a) =>
      console.log(
        `  + ${a.agentRegistry} (${a.name}) ep=${a.endpoint?.status ?? 'none'} rep=${a.reputation?.feedbackCount ?? 0}`,
      ),
    onUnresolved: (ev, reason) => console.warn(`  ! agentId ${ev.agentId} unresolved: ${reason}`),
  });
  console.log(
    `[ambit-indexer] M2 pass complete: reached block ${toBlock}, ${agents} new agent(s).`,
  );
}
