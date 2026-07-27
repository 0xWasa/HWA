// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

interface ISplitterSnapshotNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getCurrentSupply() external view returns (uint256);
    function burnedTokenCount() external view returns (uint256);
}

/// @title Splitter
/// @notice Splits received ETH between the owner, an optional secondary owner recipient, and a fixed
///         snapshot of NFT IDs.
/// @dev The NFT denominator is read atomically from `getCurrentSupply()` during construction. Only
///      token IDs at or below `MAX_TOKEN_ID` participate. A burned snapshot token cannot claim because
///      `ownerOf` no longer succeeds, and a replacement minted above the cap is intentionally ineligible.
///      Split updates affect only deposits received after the update. When configured, `claimOwner()`
///      sends 10% of its owner-side payout to the secondary recipient (7% at the initial 70/30 split).
contract Splitter is Ownable, ReentrancyGuard {
    /*//////////////////////////////////////////////////////////////
                                CONSTANTS
    //////////////////////////////////////////////////////////////*/

    address public constant NFT_ADDRESS = 0xb33d806a94B6770C9d309E0842a75f8E6edCd5A6;
    ISplitterSnapshotNFT public constant NFT = ISplitterSnapshotNFT(NFT_ADDRESS);
    uint256 public constant SWEEP_DELAY = 365 days;
    uint256 public constant BPS = 10_000;
    uint16 public constant INITIAL_OWNER_SHARE_BPS = 7_000;
    uint256 public constant SECONDARY_OWNER_DIVISOR = 10;

    /*//////////////////////////////////////////////////////////////
                                  STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice Active NFT supply captured atomically at deployment and used as the holder divisor.
    uint256 public immutable SNAPSHOT_SUPPLY;

    /// @notice Highest token ID included in the deployment snapshot.
    uint256 public immutable MAX_TOKEN_ID;

    /// @notice Earliest timestamp at which the owner may permanently close claims and sweep.
    uint256 public immutable SWEEP_AVAILABLE_AT;

    /// @notice Optional fixed recipient of 10% of each gross `claimOwner()` payout. Zero disables it.
    address public immutable SECONDARY_OWNER;

    /// @notice Cumulative ETH received before claims are closed.
    uint256 public totalReceived;

    /// @notice Current share of future deposits allocated to the owner, in basis points.
    uint16 public ownerShareBps;

    /// @notice Cumulative gross ETH allocated to the owner side when deposits were received.
    uint256 public ownerAllocated;

    /// @notice Cumulative ETH allocated to the NFT pool when deposits were received.
    uint256 public nftAllocated;

    /// @notice Cumulative gross owner-side allocation already paid out by `claimOwner()`.
    uint256 public ownerClaimed;

    /// @notice True after the first successful sweep permanently closes owner and NFT claims.
    bool public claimsClosed;

    /// @notice Cumulative per-token allocation already withdrawn for each eligible token ID.
    mapping(uint256 tokenId => uint256 amount) public claimed;

    /*//////////////////////////////////////////////////////////////
                             EVENTS / ERRORS
    //////////////////////////////////////////////////////////////*/

    event ETHReceived(address indexed sender, uint256 amount, uint256 totalReceived);
    event SplitUpdated(uint16 previousOwnerShareBps, uint16 newOwnerShareBps);
    event Claimed(address indexed account, uint256 amount, uint256[] tokenIds);
    event OwnerClaimed(address indexed owner, uint256 amount);
    event SecondaryOwnerClaimed(address indexed secondaryOwner, uint256 amount);
    event Swept(address indexed owner, uint256 amount, bool firstSweep);

    error InvalidAddress();
    error InvalidCollection();
    error InvalidMaxTokenId();
    error InvalidSnapshotSupply();
    error InvalidOwnerShare();
    error InvalidTokenId();
    error NotTokenOwner();
    error NothingToClaim();
    error ClaimsClosed();
    error SweepNotAvailable();

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    /// @param owner_ Initial owner entitled to the primary owner payout and the post-deadline sweep.
    /// @param secondaryOwner_ Optional recipient of 10% of each owner-side payout; zero disables it.
    /// @param maxTokenId_ Current highest token ID; IDs minted later are excluded.
    constructor(address owner_, address secondaryOwner_, uint256 maxTokenId_) {
        if (owner_ == address(0)) revert InvalidAddress();
        if (secondaryOwner_ == owner_) revert InvalidAddress();
        if (NFT_ADDRESS.code.length == 0) revert InvalidCollection();
        if (maxTokenId_ == 0) revert InvalidMaxTokenId();

        uint256 snapshotSupply = NFT.getCurrentSupply();
        if (snapshotSupply == 0 || snapshotSupply > maxTokenId_) revert InvalidSnapshotSupply();
        if (snapshotSupply + NFT.burnedTokenCount() != maxTokenId_) revert InvalidMaxTokenId();

        _initializeOwner(owner_);
        SNAPSHOT_SUPPLY = snapshotSupply;
        MAX_TOKEN_ID = maxTokenId_;
        SWEEP_AVAILABLE_AT = block.timestamp + SWEEP_DELAY;
        SECONDARY_OWNER = secondaryOwner_;
        ownerShareBps = INITIAL_OWNER_SHARE_BPS;
    }

    /*//////////////////////////////////////////////////////////////
                              CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    /// @notice Set the owner share for future deposits; the NFT share is the remainder.
    /// @dev Existing allocations are checkpointed and never repriced by a split update.
    function setOwnerShareBps(uint16 newOwnerShareBps) external onlyOwner {
        if (claimsClosed) revert ClaimsClosed();
        if (newOwnerShareBps > BPS) revert InvalidOwnerShare();

        uint16 previousOwnerShareBps = ownerShareBps;
        ownerShareBps = newOwnerShareBps;
        emit SplitUpdated(previousOwnerShareBps, newOwnerShareBps);
    }

    /*//////////////////////////////////////////////////////////////
                                DEPOSITS
    //////////////////////////////////////////////////////////////*/

    /// @notice Accept ETH. Deposits received after claims close are excluded from claim accounting.
    receive() external payable {
        if (!claimsClosed) {
            uint256 nftAllocation = FixedPointMathLib.fullMulDiv(msg.value, BPS - ownerShareBps, BPS);
            uint256 ownerAllocation = msg.value - nftAllocation;

            totalReceived += msg.value;
            nftAllocated += nftAllocation;
            ownerAllocated += ownerAllocation;
            emit ETHReceived(msg.sender, msg.value, totalReceived);
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 CLAIMS
    //////////////////////////////////////////////////////////////*/

    /// @notice Claim the cumulative allocation for eligible token IDs currently owned by the caller.
    /// @dev Duplicate IDs are harmless: the first occurrence updates its checkpoint and later ones add zero.
    function claim(uint256[] calldata tokenIds) external nonReentrant returns (uint256 amount) {
        if (claimsClosed) revert ClaimsClosed();

        uint256 cumulativePerToken = _claimablePerToken();
        for (uint256 i; i < tokenIds.length;) {
            uint256 tokenId = tokenIds[i];
            if (tokenId == 0 || tokenId > MAX_TOKEN_ID) revert InvalidTokenId();

            try NFT.ownerOf(tokenId) returns (address tokenOwner) {
                if (tokenOwner != msg.sender) revert NotTokenOwner();
            } catch {
                revert NotTokenOwner();
            }

            uint256 alreadyClaimed = claimed[tokenId];
            claimed[tokenId] = cumulativePerToken;
            amount += cumulativePerToken - alreadyClaimed;

            unchecked {
                ++i;
            }
        }

        if (amount == 0) revert NothingToClaim();
        SafeTransferLib.forceSafeTransferETH(msg.sender, amount);
        emit Claimed(msg.sender, amount, tokenIds);
    }

    /// @notice Permissionlessly distribute the unclaimed owner-side allocation to its fixed recipients.
    function claimOwner() external nonReentrant returns (uint256 amount) {
        if (claimsClosed) revert ClaimsClosed();

        uint256 grossAmount = ownerAllocated - ownerClaimed;
        if (grossAmount == 0) revert NothingToClaim();

        ownerClaimed = ownerAllocated;
        address recipient = owner();
        address secondaryRecipient = SECONDARY_OWNER;
        if (secondaryRecipient != address(0)) {
            uint256 secondaryAmount = grossAmount / SECONDARY_OWNER_DIVISOR;
            amount = grossAmount - secondaryAmount;
            if (secondaryAmount != 0) {
                SafeTransferLib.forceSafeTransferETH(secondaryRecipient, secondaryAmount);
                emit SecondaryOwnerClaimed(secondaryRecipient, secondaryAmount);
            }
        } else {
            amount = grossAmount;
        }

        SafeTransferLib.forceSafeTransferETH(recipient, amount);
        emit OwnerClaimed(recipient, amount);
    }

    /*//////////////////////////////////////////////////////////////
                                WIND-DOWN
    //////////////////////////////////////////////////////////////*/

    /// @notice After one year, owner can permanently close claims and transfer all residual ETH to the owner.
    /// @dev The first successful call closes claims. Later calls sweep ETH received after wind-down.
    function sweep() external onlyOwner nonReentrant returns (uint256 amount) {
        if (block.timestamp < SWEEP_AVAILABLE_AT) revert SweepNotAvailable();

        amount = address(this).balance;
        if (amount == 0) revert NothingToClaim();

        bool closesClaims = !claimsClosed;
        claimsClosed = true;
        address recipient = owner();
        SafeTransferLib.forceSafeTransferAllETH(recipient);
        emit Swept(recipient, amount, closesClaims);
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// @notice Cumulative holder allocation assigned to every snapshot token ID.
    function claimablePerToken() external view returns (uint256) {
        return _claimablePerToken();
    }

    /// @notice Current NFT share for future deposits, in basis points.
    function nftShareBps() external view returns (uint16) {
        return uint16(BPS - ownerShareBps);
    }

    /// @notice Unclaimed allocation recorded for a token ID, without checking current ownership/existence.
    function pending(uint256 tokenId) external view returns (uint256) {
        if (claimsClosed || tokenId == 0 || tokenId > MAX_TOKEN_ID) return 0;
        return _claimablePerToken() - claimed[tokenId];
    }

    /// @notice Primary owner's payout from the next `claimOwner()` call. Returns zero after claims close.
    function pendingOwner() external view returns (uint256) {
        if (claimsClosed) return 0;
        uint256 grossAmount = ownerAllocated - ownerClaimed;
        if (SECONDARY_OWNER == address(0)) return grossAmount;
        return grossAmount - grossAmount / SECONDARY_OWNER_DIVISOR;
    }

    /// @notice Secondary payout the next `claimOwner()` call will send. Returns zero when disabled or closed.
    function pendingSecondaryOwner() external view returns (uint256) {
        if (claimsClosed || SECONDARY_OWNER == address(0)) return 0;
        return (ownerAllocated - ownerClaimed) / SECONDARY_OWNER_DIVISOR;
    }

    function _claimablePerToken() internal view returns (uint256) {
        return nftAllocated / SNAPSHOT_SUPPLY;
    }
}
