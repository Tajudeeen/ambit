import {
  createPublicClient,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Hash,
  type PublicClient,
} from 'viem';
import { bscTestnet } from 'viem/chains';

// Consumer-side trust pin (AMB-2 / AMB-4): the web UI only trusts an on-chain
// score root whose methodologyHash matches this exact version. If the publisher
// ever rotates methodology without bumping this pin, the UI must reject it rather
// than blindly trusting the root.
//
// This module is intentionally self-contained: it does NOT import `@ambit/core`
// or `@ambit/contracts` (their package `main` points at unbuilt `src/*.ts`, which
// Next's webpack cannot resolve). It only needs two read-only view functions and
// the public deployment address, declared locally. SCORE_METHODOLOGY_VERSION
// mirrors `packages/core/src/version.ts` (METHODOLOGY_VERSION) and the ABI subset
// mirrors `packages/contracts/src/abi.ts` — keep all three in sync if either changes.
export const SCORE_METHODOLOGY_VERSION = 'v0.0.0';

const AMBIT_SCORE_ATTESTATION_ABI = [
  {
    type: 'function',
    name: 'latestEpoch',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'attestations',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [
      { name: 'root', type: 'bytes32' },
      { name: 'methodologyHash', type: 'bytes32' },
      { name: 'manifestHash', type: 'bytes32' },
      { name: 'sourceBlock', type: 'uint64' },
      { name: 'leafCount', type: 'uint32' },
      { name: 'publishedAtBlock', type: 'uint64' },
      { name: 'publishedAt', type: 'uint64' },
    ],
  },
] as const;

// Deployment metadata mirrors packages/contracts/src/deployments.ts
// (AMBIT_SCORE_ATTESTATION_BSC_TESTNET). Public, non-secret facts.
const SCORE_CONTRACT_ADDRESS = '0xacc188c511d2230ae0ef6e17e9c6bc54da3fe0ae' as const;
const SCORE_CONTRACT_CHAIN_ID = 97;
const SCORE_CONTRACT_EXPLORER =
  'https://testnet.bscscan.com/address/0xacc188c511d2230ae0ef6e17e9c6bc54da3fe0ae';

export function scoreMethodologyHash(version: string = SCORE_METHODOLOGY_VERSION): Hash {
  if (version.length === 0) throw new Error('methodology version is required');
  return keccak256(stringToHex(version));
}

export interface OnchainAttestation {
  contractAddress: Address;
  chainId: number;
  explorerUrl: string;
  latestEpoch: bigint;
  root: Hash;
  methodologyHash: Hash;
  sourceBlock: bigint;
  publishedAtBlock: bigint;
}

export type AttestationStatus =
  | { kind: 'verified'; attestation: OnchainAttestation }
  | { kind: 'methodology-mismatch'; pinned: Hash; onchain: Hash; attestation: OnchainAttestation }
  | { kind: 'unavailable'; reason: string };

// Read-only fetch of the latest score attestation root from the deployed contract.
// Never sends a transaction; fails closed so a missing RPC or chain error degrades
// to "unavailable" instead of breaking the profile page.
export async function fetchLatestAttestation(
  rpcUrl: string = process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL ??
    'https://data-seed-prebsc-1-s1.binance.org:8545',
): Promise<OnchainAttestation> {
  try {
    const client = createPublicClient({ chain: bscTestnet, transport: http(rpcUrl) });
    const latestEpoch = (await client.readContract({
      address: SCORE_CONTRACT_ADDRESS,
      abi: AMBIT_SCORE_ATTESTATION_ABI,
      functionName: 'latestEpoch',
    })) as bigint;

    if (latestEpoch === 0n) {
      throw new Error('no score attestation published yet');
    }

    const attestation = (await client.readContract({
      address: SCORE_CONTRACT_ADDRESS,
      abi: AMBIT_SCORE_ATTESTATION_ABI,
      functionName: 'attestations',
      args: [latestEpoch],
    })) as unknown as {
      root: Hash;
      methodologyHash: Hash;
      manifestHash: Hash;
      sourceBlock: bigint;
      leafCount: number;
      publishedAtBlock: bigint;
      publishedAt: bigint;
    };

    return {
      contractAddress: SCORE_CONTRACT_ADDRESS,
      chainId: SCORE_CONTRACT_CHAIN_ID,
      explorerUrl: SCORE_CONTRACT_EXPLORER,
      latestEpoch,
      root: attestation.root,
      methodologyHash: attestation.methodologyHash,
      sourceBlock: attestation.sourceBlock,
      publishedAtBlock: attestation.publishedAtBlock,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : 'failed to read on-chain score attestation',
    );
  }
}

// Pin + compare the consumer methodology against the deployed root. This is the
// exact check the audit requires: a consumer must reject a root whose
// methodologyHash drifts from what this build trusts (AMB-4).
export function evaluateAttestation(attestation: OnchainAttestation): AttestationStatus {
  const pinned = scoreMethodologyHash();
  if (pinned !== attestation.methodologyHash) {
    return { kind: 'methodology-mismatch', pinned, onchain: attestation.methodologyHash, attestation };
  }
  return { kind: 'verified', attestation };
}

export async function getAttestationStatus(): Promise<AttestationStatus> {
  try {
    const attestation = await fetchLatestAttestation();
    return evaluateAttestation(attestation);
  } catch (error) {
    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : 'on-chain attestation unavailable',
    };
  }
}
