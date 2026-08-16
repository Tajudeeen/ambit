/**
 * Verified on-chain registry addresses for ERC-8004 networks.
 *
 * SOURCE OF TRUTH: 8004scan.io/networks (click-through to bscscan), captured
 * 2026-08-16. These are LIVE deployed contracts, NOT guessed. BSC currently
 * has 257,114 registered agents and 11,705 feedbacks across the two registries.
 *
 * If you change these, re-verify against 8004scan first (build rule §38).
 */
export interface NetworkRegistries {
  chainId: number;
  name: string;
  /** ERC-8004 Identity Registry (ERC-721 + registration extensions). */
  identityRegistry: `0x${string}`;
  /** ERC-8004 Reputation Registry. */
  reputationRegistry: `0x${string}`;
  /** Block the registries were deployed at (safe indexing start). */
  registryDeployedAtBlock: number;
}

export const BSC_REGISTRIES: NetworkRegistries = {
  chainId: 56,
  name: 'BNB Smart Chain',
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputationRegistry: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  // Conservative start: well after ERC-8004 went live on BSC.
  registryDeployedAtBlock: 41_000_000,
};

export const NETWORKS: Record<number, NetworkRegistries> = {
  [BSC_REGISTRIES.chainId]: BSC_REGISTRIES,
};

export function getNetwork(chainId: number): NetworkRegistries {
  const n = NETWORKS[chainId];
  if (!n) throw new Error(`No ERC-8004 registry configuration for chainId ${chainId}`);
  return n;
}
