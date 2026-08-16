import { ERC8004_IDENTITY_ABI, ERC8004_REPUTATION_ABI, type NetworkRegistries } from './index.js';
import type { PublicClient } from 'viem';

/** A raw `Registered(agentId, agentURI, owner)` event as emitted on-chain. */
export interface RegisteredEvent {
  agentId: bigint;
  agentURI: string;
  owner: `0x${string}`;
  blockNumber: bigint;
  txHash: `0x${string}`;
  logIndex: number;
}

/** A raw `NewFeedback(...)` event summary used by the reputation indexer (M2+). */
export interface NewFeedbackEvent {
  agentId: bigint;
  clientAddress: `0x${string}`;
  value: bigint;
  valueDecimals: number;
  tag1: string | null;
  tag2: string | null;
  endpoint: string | null;
  feedbackURI: string | null;
  feedbackHash: `0x${string}`;
  blockNumber: bigint;
  txHash: `0x${string}`;
  logIndex: number;
}

/**
 * ERC-8004 registry reader. All reads go through viem against the LIVE
 * deployed registries (see ./networks.ts). No mocked chain state.
 */
export class Erc8004Reader {
  constructor(
    private readonly client: PublicClient,
    private readonly net: NetworkRegistries,
  ) {}

  /** Scan `Registered` events in a block range. Idempotent: caller dedupes by (txHash,logIndex). */
  async getRegisteredEvents(fromBlock: bigint, toBlock: bigint): Promise<RegisteredEvent[]> {
    const logs = await this.client.getContractEvents({
      address: this.net.identityRegistry,
      abi: ERC8004_IDENTITY_ABI,
      eventName: 'Registered',
      fromBlock,
      toBlock,
    });
    return logs.map((l) => {
      const args = l.args as { agentId: bigint; agentURI: string; owner: `0x${string}` };
      return {
        agentId: args.agentId,
        agentURI: args.agentURI,
        owner: args.owner,
        blockNumber: l.blockNumber ?? 0n,
        txHash: l.transactionHash as `0x${string}`,
        logIndex: l.logIndex ?? 0,
      };
    });
  }

  async ownerOf(agentId: bigint): Promise<`0x${string}`> {
    return this.client.readContract({
      address: this.net.identityRegistry,
      abi: ERC8004_IDENTITY_ABI,
      functionName: 'ownerOf',
      args: [agentId],
    }) as Promise<`0x${string}`>;
  }

  async tokenURI(agentId: bigint): Promise<string> {
    return this.client.readContract({
      address: this.net.identityRegistry,
      abi: ERC8004_IDENTITY_ABI,
      functionName: 'tokenURI',
      args: [agentId],
    }) as Promise<string>;
  }

  /** Scan `NewFeedback` events in a block range (used by reputation ingestion, M2+). */
  async getNewFeedbackEvents(fromBlock: bigint, toBlock: bigint): Promise<NewFeedbackEvent[]> {
    const logs = await this.client.getContractEvents({
      address: this.net.reputationRegistry,
      abi: ERC8004_REPUTATION_ABI,
      eventName: 'NewFeedback',
      fromBlock,
      toBlock,
    });
    return logs.map((l) => {
      const a = l.args as Record<string, unknown>;
      return {
        agentId: a.agentId as bigint,
        clientAddress: a.clientAddress as `0x${string}`,
        value: a.value as bigint,
        valueDecimals: a.valueDecimals as number,
        tag1: (a.tag1 as string) ?? null,
        tag2: (a.tag2 as string) ?? null,
        endpoint: (a.endpoint as string) ?? null,
        feedbackURI: (a.feedbackURI as string) ?? null,
        feedbackHash: a.feedbackHash as `0x${string}`,
        blockNumber: l.blockNumber ?? 0n,
        txHash: l.transactionHash as `0x${string}`,
        logIndex: l.logIndex ?? 0,
      };
    });
  }

  async getAgentWallet(agentId: bigint, blockNumber?: bigint): Promise<`0x${string}` | null> {
    try {
      const w = (await this.client.readContract({
        address: this.net.identityRegistry,
        abi: ERC8004_IDENTITY_ABI,
        functionName: 'getAgentWallet',
        args: [agentId],
        blockNumber,
      })) as `0x${string}`;
      // Zero address means unset.
      return w.toLowerCase() === '0x0000000000000000000000000000000000000000' ? null : w;
    } catch {
      return null;
    }
  }

  get network(): NetworkRegistries {
    return this.net;
  }
}

/** Resolve an agentURI (ipfs://, https://, or data:) to its raw JSON string. */
export async function resolveAgentURI(agentURI: string, fetchImpl = fetch): Promise<string> {
  if (agentURI.startsWith('data:')) {
    const comma = agentURI.indexOf(',');
    const meta = agentURI.slice(5, comma);
    const payload = agentURI.slice(comma + 1);
    return meta.includes('base64')
      ? Buffer.from(payload, 'base64').toString('utf8')
      : decodeURIComponent(payload);
  }
  let url = agentURI;
  if (agentURI.startsWith('ipfs://')) {
    // Gateway-resolve ipfs:// to a public gateway. Operators may override.
    url = `https://ipfs.io/ipfs/${agentURI.slice('ipfs://'.length)}`;
  }
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Failed to resolve agentURI ${agentURI}: ${res.status}`);
  return res.text();
}
