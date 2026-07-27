// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

interface ISplitterHyperEVMSnapshotNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getCurrentSupply() external view returns (uint256);
    function burnedTokenCount() external view returns (uint256);
    function snapshotFrozen() external view returns (bool);
}

/// @title SplitterHyperEVM
/// @notice HyperEVM port of FWA's Splitter, preserving its accounting, claims and wind-down semantics.
/// @dev Native ETH in the reference contract maps directly to native HYPE. The sole required chain
///      adaptation is making the snapshot NFT address constructor-bound instead of Ethereum-constant.
contract SplitterHyperEVM is Ownable, ReentrancyGuard {
    uint256 public constant SWEEP_DELAY = 365 days;
    uint256 public constant MIN_REVENUE_READY_WINDOW = 364 days;
    uint256 public constant BPS = 10_000;
    uint16 public constant INITIAL_OWNER_SHARE_BPS = 7_000;
    uint256 public constant SECONDARY_OWNER_DIVISOR = 10;

    address public immutable NFT_ADDRESS;
    ISplitterHyperEVMSnapshotNFT public immutable NFT;
    uint256 public immutable SNAPSHOT_SUPPLY;
    uint256 public immutable MAX_TOKEN_ID;
    uint256 public SWEEP_AVAILABLE_AT;
    address public immutable SECONDARY_OWNER;

    uint16 public ownerShareBps;
    uint256 public ownerAllocated;
    uint256 public nftAllocated;
    uint256 public ownerClaimed;
    bool public claimsClosed;
    bool public splitFrozen;

    mapping(uint256 tokenId => uint256 amount) public claimed;

    // Event names are intentionally identical to the Ethereum reference ABI.
    event ETHReceived(address indexed sender, uint256 amount, uint256 totalReceived);
    event SplitUpdated(uint16 previousOwnerShareBps, uint16 newOwnerShareBps);
    event Claimed(address indexed account, uint256 amount, uint256[] tokenIds);
    event OwnerClaimed(address indexed owner, uint256 amount);
    event SecondaryOwnerClaimed(address indexed secondaryOwner, uint256 amount);
    event Swept(address indexed owner, uint256 amount, bool firstSweep);
    event SplitFrozen(uint16 ownerShareBps);
    event RevenueClockStarted(uint256 sweepAvailableAt);
    event PostCloseDeposit(address indexed sender, uint256 amount);

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
    error SnapshotNotFrozen();
    error AlreadyFrozen();
    error RevenueClockAlreadyStarted();
    error SplitNotFrozen();
    error OwnershipRenounceDisabled();

    /// @param owner_ Initial recipient of the primary owner payout and post-deadline sweep.
    /// @param secondaryOwner_ Optional recipient of 10% of each gross owner-side payout.
    /// @param snapshotNft_ HyperEVM NFT collection whose current holders receive the snapshot share.
    /// @param maxTokenId_ Highest token ID included in the immutable deployment snapshot.
    constructor(address owner_, address secondaryOwner_, address snapshotNft_, uint256 maxTokenId_) {
        if (owner_ == address(0)) revert InvalidAddress();
        if (secondaryOwner_ == owner_) revert InvalidAddress();
        if (snapshotNft_ == address(0) || snapshotNft_.code.length == 0) revert InvalidCollection();
        if (maxTokenId_ == 0) revert InvalidMaxTokenId();

        ISplitterHyperEVMSnapshotNFT snapshotNft = ISplitterHyperEVMSnapshotNFT(snapshotNft_);
        uint256 snapshotSupply = snapshotNft.getCurrentSupply();
        if (!snapshotNft.snapshotFrozen()) revert SnapshotNotFrozen();
        if (snapshotSupply == 0 || snapshotSupply > maxTokenId_) revert InvalidSnapshotSupply();
        if (snapshotSupply + snapshotNft.burnedTokenCount() != maxTokenId_) revert InvalidMaxTokenId();

        _initializeOwner(owner_);
        NFT_ADDRESS = snapshotNft_;
        NFT = snapshotNft;
        SNAPSHOT_SUPPLY = snapshotSupply;
        MAX_TOKEN_ID = maxTokenId_;
        SECONDARY_OWNER = secondaryOwner_;
        ownerShareBps = INITIAL_OWNER_SHARE_BPS;
    }

    function setOwnerShareBps(uint16 newOwnerShareBps) external onlyOwner {
        if (claimsClosed || splitFrozen) revert ClaimsClosed();
        if (newOwnerShareBps > BPS) revert InvalidOwnerShare();

        uint16 previousOwnerShareBps = ownerShareBps;
        ownerShareBps = newOwnerShareBps;
        emit SplitUpdated(previousOwnerShareBps, newOwnerShareBps);
    }

    /// @notice Permanently locks the reviewed revenue split before gameplay can open.
    function freezeSplit() external onlyOwner {
        if (splitFrozen) revert AlreadyFrozen();
        splitFrozen = true;
        emit SplitFrozen(ownerShareBps);
    }

    /// @notice Starts the 365-day claim window at launch, not at infrastructure deployment.
    function startRevenueClock() external onlyOwner {
        if (!splitFrozen) revert SplitNotFrozen();
        if (SWEEP_AVAILABLE_AT != 0) revert RevenueClockAlreadyStarted();
        SWEEP_AVAILABLE_AT = block.timestamp + SWEEP_DELAY;
        emit RevenueClockStarted(SWEEP_AVAILABLE_AT);
    }

    function revenueReady() external view returns (bool) {
        return splitFrozen && SWEEP_AVAILABLE_AT >= block.timestamp + MIN_REVENUE_READY_WINDOW && !claimsClosed;
    }

    receive() external payable {
        if (!claimsClosed) {
            uint256 nftAllocation = FixedPointMathLib.fullMulDiv(msg.value, BPS - ownerShareBps, BPS);
            uint256 ownerAllocation = msg.value - nftAllocation;
            uint256 updatedNftAllocated = nftAllocated + nftAllocation;
            uint256 updatedOwnerAllocated = ownerAllocated + ownerAllocation;
            nftAllocated = updatedNftAllocated;
            ownerAllocated = updatedOwnerAllocated;
            emit ETHReceived(msg.sender, msg.value, updatedNftAllocated + updatedOwnerAllocated);
        } else {
            emit PostCloseDeposit(msg.sender, msg.value);
        }
    }

    /// @dev Renouncing would burn owner claims and permanently disable sweep. Ownership may only
    ///      move through explicit transfer/handover to another non-zero account.
    function renounceOwnership() public payable override onlyOwner {
        revert OwnershipRenounceDisabled();
    }

    /// @notice Cumulative accounted revenue, derived from the two liabilities to keep the receive path
    ///         safely below Solady's 100k no-grief native-transfer stipend even on the first deposit.
    function totalReceived() external view returns (uint256) {
        return nftAllocated + ownerAllocated;
    }

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

    function sweep() external onlyOwner nonReentrant returns (uint256 amount) {
        if (SWEEP_AVAILABLE_AT == 0 || block.timestamp < SWEEP_AVAILABLE_AT) revert SweepNotAvailable();

        amount = address(this).balance;
        if (amount == 0) revert NothingToClaim();

        bool closesClaims = !claimsClosed;
        claimsClosed = true;
        address recipient = owner();
        SafeTransferLib.forceSafeTransferAllETH(recipient);
        emit Swept(recipient, amount, closesClaims);
    }

    function claimablePerToken() external view returns (uint256) {
        return _claimablePerToken();
    }

    function nftShareBps() external view returns (uint16) {
        return uint16(BPS - ownerShareBps);
    }

    function pending(uint256 tokenId) external view returns (uint256) {
        if (claimsClosed || tokenId == 0 || tokenId > MAX_TOKEN_ID) return 0;
        return _claimablePerToken() - claimed[tokenId];
    }

    function pendingOwner() external view returns (uint256) {
        if (claimsClosed) return 0;
        uint256 grossAmount = ownerAllocated - ownerClaimed;
        if (SECONDARY_OWNER == address(0)) return grossAmount;
        return grossAmount - grossAmount / SECONDARY_OWNER_DIVISOR;
    }

    function pendingSecondaryOwner() external view returns (uint256) {
        if (claimsClosed || SECONDARY_OWNER == address(0)) return 0;
        return (ownerAllocated - ownerClaimed) / SECONDARY_OWNER_DIVISOR;
    }

    function _claimablePerToken() internal view returns (uint256) {
        return nftAllocated / SNAPSHOT_SUPPLY;
    }
}
