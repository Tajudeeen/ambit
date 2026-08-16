pragma solidity 0.8.36;

contract AmbitScoreAttestation {
    struct ScoreClaim {
        uint256 chainId;
        address identityRegistry;
        uint256 agentId;
        uint16 score;
        uint8 confidence;
        uint8 verificationTier;
        bytes32 methodologyHash;
        bytes32 evidenceHash;
        uint64 observedAtBlock;
    }

    struct RootAttestation {
        bytes32 root;
        bytes32 methodologyHash;
        bytes32 manifestHash;
        uint64 sourceBlock;
        uint32 leafCount;
        uint64 publishedAtBlock;
        uint64 publishedAt;
    }

    error ZeroPublisher();
    error Unauthorized();
    error EmptyRoot();
    error EmptyMethodology();
    error EmptyManifest();
    error EmptySnapshot();
    error FutureSourceBlock();
    error InvalidChainId();
    error InvalidIdentityRegistry();
    error InvalidScore();
    error InvalidConfidence();
    error InvalidVerificationTier();

    address public immutable publisher;
    uint256 public latestEpoch;
    mapping(uint256 epoch => RootAttestation attestation) public attestations;

    event RootPublished(
        uint256 indexed epoch,
        bytes32 indexed root,
        bytes32 indexed methodologyHash,
        bytes32 manifestHash,
        uint64 sourceBlock,
        uint32 leafCount
    );

    constructor(address publisher_) {
        if (publisher_ == address(0)) revert ZeroPublisher();
        publisher = publisher_;
    }

    function publishRoot(
        bytes32 root,
        bytes32 methodologyHash,
        bytes32 manifestHash,
        uint64 sourceBlock,
        uint32 leafCount
    ) external returns (uint256 epoch) {
        if (msg.sender != publisher) revert Unauthorized();
        if (root == bytes32(0)) revert EmptyRoot();
        if (methodologyHash == bytes32(0)) revert EmptyMethodology();
        if (manifestHash == bytes32(0)) revert EmptyManifest();
        if (leafCount == 0) revert EmptySnapshot();
        if (sourceBlock > block.number) revert FutureSourceBlock();

        epoch = ++latestEpoch;
        attestations[epoch] = RootAttestation({
            root: root,
            methodologyHash: methodologyHash,
            manifestHash: manifestHash,
            sourceBlock: sourceBlock,
            leafCount: leafCount,
            publishedAtBlock: uint64(block.number),
            publishedAt: uint64(block.timestamp)
        });

        emit RootPublished(epoch, root, methodologyHash, manifestHash, sourceBlock, leafCount);
    }

    function leafHash(ScoreClaim calldata claim) public pure returns (bytes32) {
        _validateClaim(claim);
        return _leafHash(claim);
    }

    function verifyClaim(
        uint256 epoch,
        ScoreClaim calldata claim,
        bytes32[] calldata proof
    ) external view returns (bool) {
        RootAttestation storage attestation = attestations[epoch];
        if (attestation.root == bytes32(0)) return false;
        if (!_isValidClaim(claim)) return false;
        if (claim.methodologyHash != attestation.methodologyHash) return false;
        return verifyProof(proof, attestation.root, _leafHash(claim));
    }

    function verifyProof(
        bytes32[] calldata proof,
        bytes32 root,
        bytes32 leaf
    ) public pure returns (bool) {
        bytes32 computedHash = leaf;
        for (uint256 index = 0; index < proof.length; ++index) {
            bytes32 sibling = proof[index];
            computedHash = computedHash < sibling
                ? keccak256(bytes.concat(computedHash, sibling))
                : keccak256(bytes.concat(sibling, computedHash));
        }
        return computedHash == root;
    }

    function _leafHash(ScoreClaim calldata claim) private pure returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(
                        claim.chainId,
                        claim.identityRegistry,
                        claim.agentId,
                        claim.score,
                        claim.confidence,
                        claim.verificationTier,
                        claim.methodologyHash,
                        claim.evidenceHash,
                        claim.observedAtBlock
                    )
                )
            )
        );
    }

    function _validateClaim(ScoreClaim calldata claim) private pure {
        if (claim.chainId == 0) revert InvalidChainId();
        if (claim.identityRegistry == address(0)) revert InvalidIdentityRegistry();
        if (claim.score > 100) revert InvalidScore();
        if (claim.confidence > 3) revert InvalidConfidence();
        if (claim.verificationTier > 2) revert InvalidVerificationTier();
    }

    function _isValidClaim(ScoreClaim calldata claim) private pure returns (bool) {
        return
            claim.chainId != 0 &&
            claim.identityRegistry != address(0) &&
            claim.score <= 100 &&
            claim.confidence <= 3 &&
            claim.verificationTier <= 2;
    }
}
