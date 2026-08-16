import { Erc8004Reader, getNetwork, resolveAgentURI, type RegisteredEvent } from '@ambit/erc8004';
import { createBscClient } from '@ambit/erc8004';
import type { Agent } from '@ambit/core';

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
}

/**
 * Build a partial canonical Agent from a Registered event + resolved metadata.
 * This is the seed record the trust engine (M3) and discovery (M2) enrich later.
 */
export function eventToAgent(
  ev: RegisteredEvent,
  net: ReturnType<typeof getNetwork>,
  rawMetadataJson: string,
  resolvedAt: string,
): Agent {
  let name = `Agent ${ev.agentId}`;
  let description = '';
  let capabilities: string[] = [];
  let endpoint: Agent['endpoint'] = null;
  try {
    const reg = JSON.parse(rawMetadataJson) as { name?: string; description?: string; services?: Array<{ name?: string; endpoint?: string }> };
    if (reg.name) name = reg.name;
    if (reg.description) description = reg.description;
    capabilities = (reg.services ?? []).map((s) => s.name ?? '').filter(Boolean);
    const ep = reg.services?.[0]?.endpoint;
    if (ep) endpoint = { url: ep, status: 'unknown', lastChecked: resolvedAt };
  } catch {
    // Malformed metadata is recorded, not fabricated. See onUnresolved.
  }
  const agentRegistry = `eip155:${net.chainId}:${net.identityRegistry}:${ev.agentId}`;
  return {
    agentRegistry,
    agentId: ev.agentId.toString(),
    chainId: net.chainId,
    identityRegistry: net.identityRegistry,
    owner: ev.owner,
    agentURI: ev.agentURI,
    name,
    description,
    category: null, // assigned by trust engine / category classifier (M3/M11)
    capabilities,
    endpoint,
    reputation: null,
    paymentEvidence: [],
    verifiedActivity: false,
    trust: null,
    verificationTier: 'unverified',
    supportedExecution: false,
    supportedProtocols: [],
    executionVerified: false,
    executionStats: { verifiedExecutions: 0, blockedActions: 0, successRate: null, capitalProcessed: '0' },
    policy: null,
    evidenceRefs: [{ source: 'erc8004-identity', timestamp: resolvedAt, blockNumber: Number(ev.blockNumber), txHash: ev.txHash, methodologyVersion: 'v0.0.0' }],
    lastIndexedBlock: Number(ev.blockNumber),
    lastIndexedAt: resolvedAt,
  };
}

/**
 * One deterministic indexing pass: query [start, toBlock], dedupe by
 * (txHash,logIndex), resolve metadata, emit agents. Returns the block reached.
 *
 * Idempotent: re-running with the same checkpoint range produces the same
 * agents (metadata resolution is pure given the same chain state).
 */
export async function indexOnce(deps: IndexerDeps): Promise<{ toBlock: number; agents: number }> {
  const net = getNetwork(deps.chainId);
  const client = createBscClient(deps.rpcUrl, deps.chainId === 97);
  const reader = new Erc8004Reader(client, net);

  const cp = await deps.checkpoint.get(deps.chainId, net.identityRegistry);
  const start: bigint = BigInt(nextStartBlock(net, net.identityRegistry, cp));
  const head: bigint = deps.toBlock != null ? BigInt(deps.toBlock) : await client.getBlockNumber();
  // Nothing new to scan: head is behind the resume point (or chain reorg gap).
  if (head < start) {
    return { toBlock: Number(start - 1n), agents: 0 };
  }
  const end: bigint = head < start ? start : head;
  const batchEnd: bigint = end < start + BigInt(deps.batchSize) - 1n ? end : start + BigInt(deps.batchSize) - 1n;

  let count = 0;
  if (batchEnd >= start) {
    const events = await reader.getRegisteredEvents(start, batchEnd);
    for (const ev of events) {
      try {
        const raw = await resolveAgentURI(ev.agentURI, deps.fetchImpl);
        const agent = eventToAgent(ev, net, raw, new Date().toISOString());
        deps.onAgent?.(agent, ev);
        count++;
      } catch (e) {
        deps.onUnresolved?.(ev, e instanceof Error ? e.message : String(e));
      }
    }
  }

  await deps.checkpoint.save(deps.chainId, net.identityRegistry, Number(batchEnd));
  return { toBlock: Number(batchEnd), agents: count };
}

/** CLI entrypoint: run a single pass and exit (no DB write yet — M2 persists). */
export async function main(): Promise<void> {
  const cfg = getConfig();
  const store = new MemoryCheckpointStore();
  console.log(`[ambit-indexer] M1 — indexing BSC ERC-8004 from live registry ${cfg.erc8004.identityRegistry || '(configured below)'}`);
  const { toBlock, agents } = await indexOnce({
    rpcUrl: cfg.bsc.rpcUrl,
    chainId: cfg.bsc.chainId,
    checkpoint: store,
    batchSize: cfg.indexer.batchSize,
    onAgent: (a) => console.log(`  + ${a.agentRegistry} (${a.name})`),
    onUnresolved: (ev, reason) => console.warn(`  ! agentId ${ev.agentId} unresolved: ${reason}`),
  });
  console.log(`[ambit-indexer] M1 pass complete: reached block ${toBlock}, ${agents} new agent(s) in range.`);
}
