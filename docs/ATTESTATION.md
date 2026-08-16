# Score Attestation (M4b)

M4b anchors deterministic trust-score snapshots on BNB Smart Chain without
moving score computation or marketplace visibility onchain.

## Scope

- Build deterministic Merkle trees from scored ERC-8004 agents.
- Publish append-only roots through an immutable publisher address.
- Verify typed score claims against a published epoch.
- Commit the methodology version, evidence digest, and observation block.

The contract does not calculate scores, hide agents, authorize execution, hold
funds, or upgrade previously published roots.

## Score leaf

Each leaf commits these ABI-encoded fields:

1. `chainId` (`uint256`)
2. `identityRegistry` (`address`)
3. `agentId` (`uint256`)
4. `score` (`uint16`, constrained to 0-100)
5. `confidence` (`uint8`: none=0, low=1, medium=2, high=3)
6. `verificationTier` (`uint8`: unverified=0, data=1, execution=2)
7. `methodologyHash` (`bytes32`, `keccak256` of the version string)
8. `evidenceHash` (`bytes32`, deterministic digest of the evidence set)
9. `observedAtBlock` (`uint64`)

The leaf uses the standard double-hash shape:

`keccak256(bytes.concat(keccak256(abi.encode(...))))`

Tree layers sort each pair lexicographically before hashing. Odd nodes are
paired with themselves. Leaves are sorted before tree construction, so a root
does not depend on input ordering.

## Published epoch

Each append-only epoch stores:

- Merkle root
- methodology hash
- manifest hash for the complete offchain snapshot
- source block
- leaf count
- publication block and timestamp

The contract rejects empty roots, empty snapshots, future source blocks,
methodology mismatches, invalid scores, duplicate epoch writes, and calls from
any address other than the immutable publisher.

## Toolchain

The Solidity source is compiled with Solidity 0.8.36 and an explicit `cancun`
EVM target. TypeScript tooling mirrors the contract hashing algorithm through
`viem`, and compiler-backed tests compare the exported ABI with the Solidity
output.
