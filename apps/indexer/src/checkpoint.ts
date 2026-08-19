/**
 * Indexer checkpoints. MINIMAL, TESTABLE, in-memory by default.
 *
 * The brief requires block-range + checkpoint indexing so we never re-scan the
 * whole chain. In M1 we use an in-memory map behind an interface; M1+ swaps in
 * the Postgres `IndexerCheckpoint` table (packages/db) behind the same
 * interface — no change to the indexer loop.
 */
import type { NetworkRegistries } from '@ambit/erc8004';
import type { PrismaClient } from '@ambit/db';

export interface CheckpointStore {
  get(chainId: number, contract: string): Promise<number | null>;
  save(chainId: number, contract: string, lastBlock: number): Promise<void>;
}

export class MemoryCheckpointStore implements CheckpointStore {
  private map = new Map<string, number>();
  private key(chainId: number, contract: string) {
    return `${chainId}:${contract.toLowerCase()}`;
  }
  async get(chainId: number, contract: string): Promise<number | null> {
    return this.map.get(this.key(chainId, contract)) ?? null;
  }
  async save(chainId: number, contract: string, lastBlock: number): Promise<void> {
    this.map.set(this.key(chainId, contract), lastBlock);
  }
}

export class PrismaCheckpointStore implements CheckpointStore {
  constructor(private readonly client: PrismaClient) {}

  async get(chainId: number, contract: string): Promise<number | null> {
    const checkpoint = await this.client.indexerCheckpoint.findUnique({
      where: { chainId_contract: { chainId, contract: contract.toLowerCase() } },
      select: { lastBlock: true },
    });
    return checkpoint?.lastBlock ?? null;
  }

  async save(chainId: number, contract: string, lastBlock: number): Promise<void> {
    await this.client.indexerCheckpoint.upsert({
      where: { chainId_contract: { chainId, contract: contract.toLowerCase() } },
      create: { chainId, contract: contract.toLowerCase(), lastBlock },
      update: { lastBlock },
    });
  }
}

/**
 * Deterministic next-block to scan: resume from checkpoint+1, or from the
 * registry deployment block if no checkpoint exists yet.
 */
export function nextStartBlock(
  net: NetworkRegistries,
  contract: string,
  checkpoint: number | null,
): number {
  if (checkpoint != null) return checkpoint + 1;
  return net.registryDeployedAtBlock;
}
