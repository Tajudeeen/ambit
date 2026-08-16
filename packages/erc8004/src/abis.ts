/**
 * ERC-8004 ABIs derived directly from the authoritative ERC-8004 specification
 * (eips.ethereum.org/EIPS/eip-8004, Draft, 2025-08-13).
 *
 * These are the EXACT function/event signatures the indexer (M1) and trust
 * engine (M3) call. Do not "invent" signatures — they map 1:1 to the spec.
 *
 * Two registries are required for the marketplace:
 *   - Identity Registry  (ERC-721 + URIStorage + metadata)
 *   - Reputation Registry (feedback signals)
 * The Validation Registry (TEE/zkML/staking) is out of scope for M0-M3.
 */

/** Identity Registry: ERC-721 base + registration file + optional metadata. */
export const ERC8004_IDENTITY_ABI = [
  // ERC-721 base (subset used by indexer)
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },

  // ERC-8004 registration / metadata extensions
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] },
  { type: 'function', name: 'setAgentURI', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'newURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'getMetadata', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'metadataKey', type: 'string' }], outputs: [{ name: '', type: 'bytes' }] },
  { type: 'function', name: 'getAgentWallet', stateMutability: 'view', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'setAgentWallet', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'newWallet', type: 'address' }, { name: 'deadline', type: 'uint256' }, { name: 'signature', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'unsetAgentWallet', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },

  // Events
  { type: 'event', name: 'Registered', inputs: [{ name: 'agentId', type: 'uint256', indexed: true }, { name: 'agentURI', type: 'string', indexed: false }, { name: 'owner', type: 'address', indexed: true }], anonymous: false },
  { type: 'event', name: 'URIUpdated', inputs: [{ name: 'agentId', type: 'uint256', indexed: true }, { name: 'newURI', type: 'string', indexed: false }, { name: 'updatedBy', type: 'address', indexed: true }], anonymous: false },
  { type: 'event', name: 'MetadataSet', inputs: [{ name: 'agentId', type: 'uint256', indexed: true }, { name: 'indexedMetadataKey', type: 'string', indexed: true }, { name: 'metadataKey', type: 'string', indexed: false }, { name: 'metadataValue', type: 'bytes', indexed: false }], anonymous: false },
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'tokenId', type: 'uint256', indexed: true }], anonymous: false }
] as const;

/** Reputation Registry. */
export const ERC8004_REPUTATION_ABI = [
  // Link back to identity registry
  { type: 'function', name: 'getIdentityRegistry', stateMutability: 'view', inputs: [], outputs: [{ name: 'identityRegistry', type: 'address' }] },
  { type: 'function', name: 'initialize', stateMutability: 'nonpayable', inputs: [{ name: 'identityRegistry_', type: 'address' }], outputs: [] },

  // Feedback
  { type: 'function', name: 'giveFeedback', stateMutability: 'nonpayable', inputs: [
    { name: 'agentId', type: 'uint256' },
    { name: 'value', type: 'int128' },
    { name: 'valueDecimals', type: 'uint8' },
    { name: 'tag1', type: 'string' },
    { name: 'tag2', type: 'string' },
    { name: 'endpoint', type: 'string' },
    { name: 'feedbackURI', type: 'string' },
    { name: 'feedbackHash', type: 'bytes32' }
  ], outputs: [] },

  { type: 'event', name: 'NewFeedback', inputs: [
    { name: 'agentId', type: 'uint256', indexed: true },
    { name: 'clientAddress', type: 'address', indexed: true },
    { name: 'feedbackIndex', type: 'uint64', indexed: false },
    { name: 'value', type: 'int128', indexed: false },
    { name: 'valueDecimals', type: 'uint8', indexed: false },
    { name: 'indexedTag1', type: 'string', indexed: true },
    { name: 'tag1', type: 'string', indexed: false },
    { name: 'tag2', type: 'string', indexed: false },
    { name: 'endpoint', type: 'string', indexed: false },
    { name: 'feedbackURI', type: 'string', indexed: false },
    { name: 'feedbackHash', type: 'bytes32', indexed: false }
  ], anonymous: false }
] as const;

/**
 * Agent Registration File (ERC-8004 §Agent URI). The `agentURI` MUST resolve to
 * this JSON. The indexer (M2) fetches and validates against this shape.
 */
export interface AgentRegistrationFile {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';
  name: string;
  description: string;
  image?: string;
  services: Array<{ name: string; endpoint: string; version?: string; skills?: unknown[]; domains?: unknown[] }>;
  x402Support: boolean;
  active: boolean;
  registrations?: Array<{ agentId: number; agentRegistry: string }>;
  supportedTrust?: string[];
}

/** Off-chain feedback file structure (ERC-8004 §Off-Chain Feedback File). */
export interface FeedbackFile {
  agentRegistry: string;
  agentId: number;
  clientAddress: string;
  createdAt: string;
  value: number;
  valueDecimals: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  proofOfPayment?: { fromAddress: string; toAddress: string; chainId: string; txHash: string };
  [key: string]: unknown;
}
