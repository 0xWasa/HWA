// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {MerkleProofLib} from "solady/src/utils/MerkleProofLib.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

/// @title FWAClaim
/// @notice Merkle-gated distribution of FWAToken to snapshot wallets. Each leaf commits to
///         `(claimant, amount)` using the OpenZeppelin StandardMerkleTree encoding
///         (`keccak256(bytes.concat(keccak256(abi.encode(claimant, amount))))`), so trees built
///         with the OpenZeppelin merkle-tree JS library verify directly. A wallet can only claim for itself,
///         once. The owner sets the root, toggles claims, and can rescue unclaimed tokens.
/// @dev    This contract must be registered as a distributor on FWAToken
///         (`FWAToken.setDistributor(address(this), true)`) or payouts revert on the transfer lock.
contract FWAClaim is Ownable {
    /*//////////////////////////////////////////////////////////////
                                 STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice The FWAToken paid out by claims.
    address public immutable token;

    /// @notice Root of the claim tree; updatable until claims are final (owner-only).
    bytes32 public merkleRoot;

    /// @notice Kill switch: claims only execute while true.
    bool public claimsEnabled;

    /// @notice Wallets that have already claimed.
    mapping(address claimant => bool) public claimed;

    /*//////////////////////////////////////////////////////////////
                             EVENTS / ERRORS
    //////////////////////////////////////////////////////////////*/

    event Claimed(address indexed claimant, uint256 amount);
    event MerkleRootSet(bytes32 root);
    event ClaimsEnabledSet(bool enabled);
    event Rescued(address indexed to, uint256 amount);

    error ClaimsDisabled();
    error AlreadyClaimed();
    error InvalidProof();
    error InvalidAddress();

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    constructor(address token_, address owner_) {
        if (token_ == address(0) || owner_ == address(0)) revert InvalidAddress();
        token = token_;
        _initializeOwner(owner_);
    }

    /*//////////////////////////////////////////////////////////////
                                 CLAIM
    //////////////////////////////////////////////////////////////*/

    /// @notice Claim your allocation. `amount` and `proof` come from the published claims file;
    ///         the leaf is bound to `msg.sender`, so only the snapshot wallet itself can claim.
    function claim(uint256 amount, bytes32[] calldata proof) external {
        if (!claimsEnabled) revert ClaimsDisabled();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProofLib.verifyCalldata(proof, merkleRoot, leaf)) revert InvalidProof();

        claimed[msg.sender] = true;
        SafeTransferLib.safeTransfer(token, msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    /// @notice Set or replace the claim tree root. Intended to be finalized before enabling claims.
    function setMerkleRoot(bytes32 root) external onlyOwner {
        merkleRoot = root;
        emit MerkleRootSet(root);
    }

    /// @notice Enable or disable claiming.
    function setClaimsEnabled(bool enabled) external onlyOwner {
        claimsEnabled = enabled;
        emit ClaimsEnabledSet(enabled);
    }

    /// @notice Recover unclaimed or excess tokens.
    function rescue(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();
        SafeTransferLib.safeTransfer(token, to, amount);
        emit Rescued(to, amount);
    }
}
