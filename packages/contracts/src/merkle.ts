import type { Agent, Confidence, Evidence, VerificationTier } from '@ambit/core';
import {
  concatHex,
  encodeAbiParameters,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from 'viem';

export type ConfidenceCode = 0 | 1 | 2 | 3;
export type VerificationTierCode = 0 | 1 | 2;

export interface ScoreClaim {
  chainId: bigint;
  identityRegistry: Address;
  agentId: bigint;
  score: number;
  confidence: ConfidenceCode;
  verificationTier: VerificationTierCode;
  methodologyHash: Hex;
  evidenceHash: Hex;
  observedAtBlock: bigint;
}

export interface ScoreMerkleTree {
  root: Hex;
  leaves: readonly Hex[];
  getProof: (claim: ScoreClaim) => Hex[];
}

export interface ScoreSnapshot extends ScoreMerkleTree {
  methodologyHash: Hex;
  manifestHash: Hex;
  sourceBlock: bigint;
  leafCount: number;
}

const UINT64_MAX = (1n << 64n) - 1n;

const CONFIDENCE_CODES: Record<Confidence, ConfidenceCode> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const TIER_CODES: Record<VerificationTier, VerificationTierCode> = {
  unverified: 0,
  'data-verified': 1,
  'execution-verified': 2,
};

const SCORE_LEAF_PARAMETERS = [
  { type: 'uint256', name: 'chainId' },
  { type: 'address', name: 'identityRegistry' },
  { type: 'uint256', name: 'agentId' },
  { type: 'uint16', name: 'score' },
  { type: 'uint8', name: 'confidence' },
  { type: 'uint8', name: 'verificationTier' },
  { type: 'bytes32', name: 'methodologyHash' },
  { type: 'bytes32', name: 'evidenceHash' },
  { type: 'uint64', name: 'observedAtBlock' },
] as const;

const EVIDENCE_PARAMETERS = [
  { type: 'string', name: 'source' },
  { type: 'string', name: 'timestamp' },
  { type: 'uint256', name: 'blockNumber' },
  { type: 'string', name: 'txHash' },
  { type: 'string', name: 'methodologyVersion' },
] as const;

const MANIFEST_PARAMETERS = [
  { type: 'bytes32[]', name: 'leaves' },
  { type: 'bytes32', name: 'methodologyHash' },
  { type: 'uint64', name: 'sourceBlock' },
] as const;

export function hashMethodologyVersion(version: string): Hex {
  if (version.length === 0) throw new Error('methodology version is required');
  return keccak256(stringToHex(version));
}

export function hashEvidenceSet(evidence: readonly Evidence[]): Hex {
  const itemHashes = evidence
    .map((item) =>
      keccak256(
        encodeAbiParameters(EVIDENCE_PARAMETERS, [
          item.source,
          item.timestamp,
          BigInt(item.blockNumber ?? 0),
          item.txHash?.toLowerCase() ?? '',
          item.methodologyVersion ?? '',
        ]),
      ),
    )
    .sort(compareHex);

  return keccak256(itemHashes.length === 0 ? '0x' : concatHex(itemHashes));
}

export function scoreClaimFromAgent(agent: Agent, observedAtBlock: bigint): ScoreClaim {
  if (!agent.trust) throw new Error(`agent ${agent.agentRegistry} has no trust score`);
  if (!isAddress(agent.identityRegistry)) {
    throw new Error(`agent ${agent.agentRegistry} has an invalid identity registry`);
  }

  let agentId: bigint;
  try {
    agentId = BigInt(agent.agentId);
  } catch {
    throw new Error(`agent ${agent.agentRegistry} has an invalid agentId`);
  }
  if (agentId < 0n) throw new Error(`agent ${agent.agentRegistry} has an invalid agentId`);

  return {
    chainId: BigInt(agent.chainId),
    identityRegistry: agent.identityRegistry,
    agentId,
    score: agent.trust.score,
    confidence: CONFIDENCE_CODES[agent.trust.confidence],
    verificationTier: TIER_CODES[agent.verificationTier],
    methodologyHash: hashMethodologyVersion(agent.trust.methodologyVersion),
    evidenceHash: hashEvidenceSet([...agent.evidenceRefs, ...agent.trust.evidence]),
    observedAtBlock,
  };
}

export function hashScoreLeaf(claim: ScoreClaim): Hex {
  validateClaim(claim);
  const inner = keccak256(
    encodeAbiParameters(SCORE_LEAF_PARAMETERS, [
      claim.chainId,
      claim.identityRegistry,
      claim.agentId,
      claim.score,
      claim.confidence,
      claim.verificationTier,
      claim.methodologyHash,
      claim.evidenceHash,
      claim.observedAtBlock,
    ]),
  );
  return keccak256(inner);
}

export function buildScoreMerkleTree(claims: readonly ScoreClaim[]): ScoreMerkleTree {
  if (claims.length === 0) throw new Error('cannot build an empty score tree');
  const leaves = claims.map(hashScoreLeaf).sort(compareHex);
  for (let index = 1; index < leaves.length; index++) {
    if (leaves[index] === leaves[index - 1]) throw new Error('duplicate score leaf');
  }

  const layers: Hex[][] = [leaves];
  while (layers[layers.length - 1]!.length > 1) {
    const current = layers[layers.length - 1]!;
    const next: Hex[] = [];
    for (let index = 0; index < current.length; index += 2) {
      next.push(hashPair(current[index]!, current[index + 1] ?? current[index]!));
    }
    layers.push(next);
  }

  return {
    root: layers[layers.length - 1]![0]!,
    leaves,
    getProof: (claim) => proofForLeaf(layers, hashScoreLeaf(claim)),
  };
}

export function buildScoreSnapshot(claims: readonly ScoreClaim[]): ScoreSnapshot {
  const tree = buildScoreMerkleTree(claims);
  const first = claims[0]!;
  for (const claim of claims) {
    if (claim.methodologyHash !== first.methodologyHash) {
      throw new Error('all snapshot claims must use one methodology');
    }
    if (claim.observedAtBlock !== first.observedAtBlock) {
      throw new Error('all snapshot claims must use one observation block');
    }
  }

  return {
    ...tree,
    methodologyHash: first.methodologyHash,
    manifestHash: keccak256(
      encodeAbiParameters(MANIFEST_PARAMETERS, [
        [...tree.leaves],
        first.methodologyHash,
        first.observedAtBlock,
      ]),
    ),
    sourceBlock: first.observedAtBlock,
    leafCount: tree.leaves.length,
  };
}

export function verifyScoreProof(claim: ScoreClaim, proof: readonly Hex[], root: Hex): boolean {
  let computed = hashScoreLeaf(claim);
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed === root;
}

export function hashPair(left: Hex, right: Hex): Hex {
  return keccak256(
    compareHex(left, right) <= 0 ? concatHex([left, right]) : concatHex([right, left]),
  );
}

function proofForLeaf(layers: readonly Hex[][], leaf: Hex): Hex[] {
  let index = layers[0]!.indexOf(leaf);
  if (index < 0) throw new Error('claim is not present in the score tree');

  const proof: Hex[] = [];
  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex++) {
    const layer = layers[layerIndex]!;
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push(layer[siblingIndex] ?? layer[index]!);
    index = Math.floor(index / 2);
  }
  return proof;
}

function validateClaim(claim: ScoreClaim): void {
  if (!Number.isInteger(claim.score) || claim.score < 0 || claim.score > 100) {
    throw new Error('score must be an integer from 0 to 100');
  }
  if (claim.chainId <= 0n) throw new Error('chainId must be positive');
  if (!isAddress(claim.identityRegistry) || /^0x0{40}$/u.test(claim.identityRegistry)) {
    throw new Error('identityRegistry must be a non-zero address');
  }
  if (claim.agentId < 0n) throw new Error('agentId must be non-negative');
  if (!Number.isInteger(claim.confidence) || claim.confidence < 0 || claim.confidence > 3) {
    throw new Error('confidence must be an integer from 0 to 3');
  }
  if (
    !Number.isInteger(claim.verificationTier) ||
    claim.verificationTier < 0 ||
    claim.verificationTier > 2
  ) {
    throw new Error('verificationTier must be an integer from 0 to 2');
  }
  if (claim.observedAtBlock < 0n || claim.observedAtBlock > UINT64_MAX) {
    throw new Error('observedAtBlock must fit uint64');
  }
}

function compareHex(left: Hex, right: Hex): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
