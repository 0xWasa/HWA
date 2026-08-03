// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MerkleProofLib} from "solady/src/utils/MerkleProofLib.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

/// @title HWA v2 migration distributor
/// @notice Immutable, ownerless 1:1 migration claims for balances captured at SNAPSHOT_BLOCK.
/// @dev Leaves use OpenZeppelin StandardMerkleTree encoding:
///      keccak256(bytes.concat(keccak256(abi.encode(account, amount)))).
///      There is deliberately no expiry, root update, pause, or token rescue path.
contract HWAV2MigrationDistributor {
    address public immutable TOKEN;
    address public immutable OLD_TOKEN;
    bytes32 public immutable MERKLE_ROOT;
    uint64 public immutable SNAPSHOT_BLOCK;
    uint256 public immutable MIGRATION_ALLOCATION;

    mapping(address account => bool hasClaimed) public claimed;
    uint256 public totalClaimed;

    event Claimed(address indexed account, uint256 amount);

    error InvalidConfig();
    error AlreadyClaimed();
    error InvalidProof();
    error AllocationExceeded();

    constructor(
        address token,
        address oldToken,
        bytes32 merkleRoot,
        uint64 snapshotBlock,
        uint256 migrationAllocation
    ) {
        if (
            token == address(0) || token.code.length == 0 || oldToken == address(0) || oldToken.code.length == 0
                || merkleRoot == bytes32(0) || snapshotBlock == 0 || snapshotBlock > block.number
                || migrationAllocation == 0
        ) revert InvalidConfig();

        TOKEN = token;
        OLD_TOKEN = oldToken;
        MERKLE_ROOT = merkleRoot;
        SNAPSHOT_BLOCK = snapshotBlock;
        MIGRATION_ALLOCATION = migrationAllocation;
    }

    function leaf(address account, uint256 amount) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function claim(uint256 amount, bytes32[] calldata proof) external {
        if (claimed[msg.sender]) revert AlreadyClaimed();
        if (amount == 0 || !MerkleProofLib.verifyCalldata(proof, MERKLE_ROOT, leaf(msg.sender, amount))) {
            revert InvalidProof();
        }

        uint256 claimedAfter = totalClaimed + amount;
        if (claimedAfter > MIGRATION_ALLOCATION) revert AllocationExceeded();

        claimed[msg.sender] = true;
        totalClaimed = claimedAfter;
        SafeTransferLib.safeTransfer(TOKEN, msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function fullyFunded() external view returns (bool) {
        return SafeTransferLib.balanceOf(TOKEN, address(this)) + totalClaimed == MIGRATION_ALLOCATION;
    }
}