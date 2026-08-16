import { METHODOLOGY_VERSION, type Evidence } from '@ambit/core';

/**
 * On-chain ACTIVITY VERIFICATION (brief §6 "verified activity", M4).
 *
 * HONEST DESIGN: We do NOT deploy a contract with a fabricated address, and we
 * do NOT assert activity we cannot prove. "Verified activity" means the agent's
 * registered `agentWallet` has a real, observable on-chain footprint:
 *   - `getTransactionCount` (nonce) => how many transactions the wallet had sent
 *     at one explicit block. This is a verified, replayable on-chain fact.
 *
 * Provenance: every result carries the block numbers + the chain used, so the
 * claim "this agent is active" is independently reproducible. No LLM, no trust.
 *
 * This is the read-only Tier-1 activity signal. The Tier-2 *execution-verified*
 * track (Altana sessions / bounded execution) is a separate, opt-in layer (M7)
 * built on top of this provenance primitive.
 */

export interface ActivityOptions {
  /** Wallet to inspect (the agent's registered agentWallet). */
  wallet: `0x${string}`;
  /** Block used for a reproducible transaction-count snapshot. */
  observedAtBlock: bigint;
  /** ISO-8601 time the indexer observed the snapshot. */
  observedAt: string;
  /** A wallet is "active" if it has sent >= this many transactions. */
  minTransactionCount?: number;
}

export interface ActivityResult {
  verifiedActivity: boolean;
  transactionCount: number;
  observedAtBlock: bigint;
  observedAt: string;
  evidence: Evidence[];
}

export interface ActivityClient {
  getTransactionCount: (args: { address: `0x${string}`; blockNumber: bigint }) => Promise<number>;
}

/** Verify on-chain activity for an agent wallet. Pure given (client, opts). */
export async function verifyActivity(
  client: ActivityClient,
  opts: ActivityOptions,
): Promise<ActivityResult> {
  const minTransactionCount = opts.minTransactionCount ?? 1;
  if (!Number.isSafeInteger(minTransactionCount) || minTransactionCount < 1) {
    throw new Error('minTransactionCount must be a positive safe integer');
  }

  const transactionCount = await client.getTransactionCount({
    address: opts.wallet,
    blockNumber: opts.observedAtBlock,
  });
  if (!Number.isSafeInteger(transactionCount) || transactionCount < 0) {
    throw new Error('transactionCount must be a non-negative safe integer');
  }

  const observedAtBlock = Number(opts.observedAtBlock);
  if (!Number.isSafeInteger(observedAtBlock) || observedAtBlock < 0) {
    throw new Error('observedAtBlock must fit in a non-negative safe integer');
  }

  const verifiedActivity = transactionCount >= minTransactionCount;

  const evidence: Evidence[] = [
    {
      source: 'onchain-wallet-transaction-count',
      timestamp: opts.observedAt,
      blockNumber: observedAtBlock,
      methodologyVersion: METHODOLOGY_VERSION,
    },
  ];

  return {
    verifiedActivity,
    transactionCount,
    observedAtBlock: opts.observedAtBlock,
    observedAt: opts.observedAt,
    evidence,
  };
}
