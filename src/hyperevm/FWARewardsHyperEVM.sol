// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";

interface IFWAProtocolSwapAdapter {
    function TOKEN() external view returns (address);
    function buyExactInput(uint256 minOut, uint160 sqrtPriceLimitX96) external payable returns (uint256 tokenOut);
}

interface ITokenBurnable {
    function burn(uint256 amount) external;
}

interface IHWASeasonPrice {
    function launchHwaPerHypeX96() external view returns (uint256);
    function twapHwaPerHypeX96() external view returns (uint256);
}

interface IFWARewardsCore {
    function canRescueRewards() external view returns (bool);
}

interface IFWARewards {
    function onListingActivated(uint256 listingId, address depositor, uint256 backing) external;
    function onListingRepriced(uint256 listingId, uint256 backing) external;
    function onListingRemoved(uint256 listingId) external;
    function registerAcquisition(uint256 requestId, address purchaser, uint256 fee, uint256 surchargeBps)
        external
        returns (uint256 slice, uint64 rewardEpoch);
    function settleAcquisition(uint256 requestId) external payable;
    function refundAcquisition(uint256 requestId) external;
    function startEmission() external;
    function buyFor(address recipient, uint256 minOut) external payable returns (uint256 tokenOut);
}

/// @title HWA rewards v2
/// @notice Fixed-supply, volume-capped seasonal incentives plus revenue-funded buyback rewards.
contract FWARewardsHyperEVM is Ownable, ReentrancyGuard, IFWARewards {
    uint256 public constant BPS = 10_000;
    uint256 public constant Q96 = 1 << 96;
    uint256 internal constant SCALE = 1e36;
    uint256 public constant EPOCH_DURATION = 1 days;
    uint256 public constant SEASON_DURATION = 15 days;
    uint256 public constant SEASON_EPOCHS = 15;
    uint256 public constant SEASON_COUNT = 3;
    uint256 public constant EMISSION_DAYS = 45;
    uint256 public constant EMISSION_DURATION = 45 days;
    uint256 public constant SEASONAL_RESERVE = 100_000_000 ether;
    uint256 public constant DEPOSITOR_SEASONAL_RESERVE = 50_000_000 ether;
    uint256 public constant PURCHASER_SEASONAL_RESERVE = 50_000_000 ether;
    uint256 public constant VALUE_CAP_BPS = 500;

    enum AcquisitionRewardStatus {
        None,
        Pending,
        Settled,
        Refunded
    }

    struct ListingReward {
        address depositor;
        bool active;
        uint256 sqrtBacking;
        uint256 tokenDebt;
    }

    struct AcquisitionReward {
        address purchaser;
        uint64 epoch;
        AcquisitionRewardStatus status;
        uint256 tokenSlice;
    }

    address public immutable token;
    IFWAProtocolSwapAdapter public immutable swapAdapter;
    address public immutable seasonExcludedDepositor;
    address public fwa;

    mapping(uint256 => ListingReward) public listingRewards;
    mapping(uint256 => bool) public seasonalListingEligible;
    mapping(uint256 => uint256) public seasonalTokenDebt;
    uint256 public sqrtBackingTotal;
    uint256 public accTokenPerSqrt;
    uint256 public seasonalSqrtBackingTotal;
    uint256 public accSeasonalTokenPerSqrt;
    mapping(address => uint256) public tokenCredit;

    // Compatibility/readability views. V2 emission is volume-triggered, not a guaranteed stream.
    uint256 public depositorRatePerSec;
    uint256 public purchaserDailyPot;
    uint256 public depositorEmissionRemaining;
    uint256 public lastTokenAccrual;

    uint256 public tokenLiability;
    uint256 public seasonalReserveRemaining;
    uint256 public seasonalEmitted;
    uint256 public seasonalBurned;
    uint256 public seasonalDepositorEmitted;
    uint256 public seasonalPurchaserEmitted;
    uint256 public buybackDepositorRouted;
    uint256 public buybackPurchaserRouted;
    bool public emissionConfigured;
    bool public claimsEnabled;

    mapping(address => uint256) public tokenBuyAllowance;
    uint256 public tokenBuyAllowanceTotal;
    mapping(uint256 => AcquisitionReward) public acquisitionRewards;
    mapping(uint256 => uint256) public acquisitionSettledFee;
    uint256 public hotGap = 60;
    uint256 public coldGap = 3600;
    int256 public forcedTokenShareBps = -1;
    uint256 public lastAcquisitionTs;

    uint256 public emissionStart;
    mapping(uint256 => uint256) public purchaserEpochPot;
    mapping(uint256 => uint256) public purchaserSeasonalEpochPot;
    mapping(uint256 => uint256) public epochSeasonalEmitted;
    mapping(uint256 => uint256) public settledHypeInEpoch;
    mapping(uint256 => mapping(address => uint256)) public userSettledHypeInEpoch;
    mapping(uint256 => uint256) public acquisitionsInEpoch;
    mapping(uint256 => mapping(address => uint256)) public userAcquisitionsInEpoch;
    mapping(uint256 => uint256) public pendingAcquisitionsInEpoch;
    mapping(uint256 => mapping(address => bool)) public purchaserClaimed;
    mapping(uint256 => bool) public purchaserEpochSwept;
    mapping(uint256 => bool) public epochFinalized;

    event FWASet(address indexed fwa);
    event ListingRewardActivated(
        uint256 indexed listingId, address indexed depositor, uint256 backing, uint256 sqrtBacking
    );
    event ListingRewardRepriced(uint256 indexed listingId, uint256 backing, uint256 sqrtBacking);
    event ListingRewardRemoved(uint256 indexed listingId, address indexed depositor);
    event AcquisitionRewardRegistered(
        uint256 indexed requestId,
        address indexed purchaser,
        uint64 indexed epoch,
        uint256 tokenSlice,
        uint256 tokenShareBps
    );
    event AcquisitionTokenAccrued(address indexed purchaser, uint256 indexed requestId, uint256 slice);
    event AcquisitionRewardRefunded(uint256 indexed requestId, uint64 indexed epoch);
    event SeasonalValueUnlocked(
        uint256 indexed requestId,
        uint256 indexed epoch,
        uint256 settledHype,
        uint256 quoteHwaPerHypeX96,
        uint256 depositorAmount,
        uint256 purchaserAmount
    );
    event EpochFinalized(uint256 indexed epoch, uint256 emitted, uint256 burned);
    event ClaimsEnabled();
    event AccruedTokensClaimed(address indexed purchaser, uint256 ethSpent, uint256 tokenOut);
    event TokenBuyAllowanceWithdrawn(address indexed purchaser, uint256 amount);
    event DepositorTokensAccrued(address indexed depositor, uint256 indexed listingId, uint256 amount);
    event TokensWithdrawn(address indexed depositor, uint256 amount);
    event PurchaserTokensClaimed(address indexed purchaser, uint256 indexed epoch, uint256 amount);
    event PurchaserTokensRouted(uint256 indexed epoch, uint256 amount);
    event ProtocolTokensRedistributed(uint256 amount);
    event EmissionConfigured(uint256 depositorRatePerSec, uint256 purchaserDailyPot);
    event EmissionStarted(uint256 timestamp);
    event ColdGapBandsUpdated(uint256 hotGap, uint256 coldGap);
    event ForcedTokenShareBpsUpdated(int256 bps);
    event EmptyEpochSwept(uint256 indexed epoch, address indexed to, uint256 amount);
    event TokensRescued(address indexed to, uint256 amount);
    event EmptyEpochBurned(uint256 indexed epoch, uint256 amount);

    error ZeroAddress();
    error InvalidConfig();
    error OnlyFWA();
    error FWAAlreadySet();
    error ListingAlreadyActive();
    error ListingNotActive();
    error NotDepositor();
    error UnknownRequest();
    error AcquisitionAlreadyTerminal();
    error IncorrectTokenSlice();
    error NoTokenReward();
    error EmissionAlreadyStarted();
    error EmissionNotConfigured();
    error EpochNotClosed();
    error EpochStillPending();
    error AlreadyClaimed();
    error NotToken();
    error RescueNotAllowed();
    error ClaimsPaused();
    error InsufficientFunding();
    error EpochNotEmpty();

    constructor(address token_, address adapter_, address owner_) {
        if (token_ == address(0) || adapter_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (token_.code.length == 0 || adapter_.code.length == 0) revert InvalidConfig();
        IFWAProtocolSwapAdapter candidate = IFWAProtocolSwapAdapter(adapter_);
        if (candidate.TOKEN() != token_) revert InvalidConfig();
        token = token_;
        swapAdapter = candidate;
        seasonExcludedDepositor = owner_;
        _initializeOwner(owner_);
    }
    modifier onlyFWA() {
        if (msg.sender != fwa) revert OnlyFWA();
        _;
    }
    modifier whenClaimsEnabled() {
        if (!claimsEnabled) revert ClaimsPaused();
        _;
    }

    function setFWA(address fwa_) external onlyOwner {
        if (fwa_ == address(0)) revert ZeroAddress();
        if (fwa != address(0)) revert FWAAlreadySet();
        fwa = fwa_;
        emit FWASet(fwa_);
    }

    function onListingActivated(uint256 listingId, address depositor, uint256 backing) external onlyFWA {
        if (depositor == address(0) || backing == 0) revert InvalidConfig();
        ListingReward storage reward = listingRewards[listingId];
        if (reward.active) revert ListingAlreadyActive();
        uint256 sqrtBacking = FixedPointMathLib.sqrt(backing);
        reward.depositor = depositor;
        reward.active = true;
        reward.sqrtBacking = sqrtBacking;
        reward.tokenDebt = _ceilDiv(sqrtBacking * accTokenPerSqrt, SCALE);
        sqrtBackingTotal += sqrtBacking;
        bool eligible = depositor != seasonExcludedDepositor;
        seasonalListingEligible[listingId] = eligible;
        if (eligible) {
            seasonalTokenDebt[listingId] = _ceilDiv(sqrtBacking * accSeasonalTokenPerSqrt, SCALE);
            seasonalSqrtBackingTotal += sqrtBacking;
        }
        emit ListingRewardActivated(listingId, depositor, backing, sqrtBacking);
    }

    function onListingRepriced(uint256 listingId, uint256 backing) external onlyFWA {
        if (backing == 0) revert InvalidConfig();
        ListingReward storage reward = listingRewards[listingId];
        if (!reward.active) revert ListingNotActive();
        _creditPending(listingId, reward);
        uint256 oldSqrt = reward.sqrtBacking;
        uint256 nextSqrt = FixedPointMathLib.sqrt(backing);
        sqrtBackingTotal = sqrtBackingTotal - oldSqrt + nextSqrt;
        if (seasonalListingEligible[listingId]) {
            seasonalSqrtBackingTotal = seasonalSqrtBackingTotal - oldSqrt + nextSqrt;
            seasonalTokenDebt[listingId] = _ceilDiv(nextSqrt * accSeasonalTokenPerSqrt, SCALE);
        }
        reward.sqrtBacking = nextSqrt;
        reward.tokenDebt = _ceilDiv(nextSqrt * accTokenPerSqrt, SCALE);
        emit ListingRewardRepriced(listingId, backing, nextSqrt);
    }

    function onListingRemoved(uint256 listingId) external onlyFWA {
        ListingReward storage reward = listingRewards[listingId];
        if (!reward.active) revert ListingNotActive();
        _creditPending(listingId, reward);
        address depositor = reward.depositor;
        sqrtBackingTotal -= reward.sqrtBacking;
        if (seasonalListingEligible[listingId]) seasonalSqrtBackingTotal -= reward.sqrtBacking;
        delete seasonalListingEligible[listingId];
        delete seasonalTokenDebt[listingId];
        delete listingRewards[listingId];
        emit ListingRewardRemoved(listingId, depositor);
    }

    function registerAcquisition(uint256 requestId, address purchaser, uint256 fee, uint256 surchargeBps)
        external
        onlyFWA
        returns (uint256 slice, uint64 rewardEpoch)
    {
        if (purchaser == address(0) || fee == 0 || surchargeBps > type(uint256).max - BPS) {
            revert InvalidConfig();
        }
        if (acquisitionRewards[requestId].status != AcquisitionRewardStatus.None) revert AcquisitionAlreadyTerminal();
        uint256 shareBps;
        int256 forced = forcedTokenShareBps;
        if (forced >= 0) {
            shareBps = uint256(forced);
        } else {
            uint256 gap = lastAcquisitionTs == 0 ? coldGap : block.timestamp - lastAcquisitionTs;
            shareBps = tokenShareBps(gap);
        }
        uint256 ev = FixedPointMathLib.fullMulDiv(fee, BPS, BPS + surchargeBps);
        slice = FixedPointMathLib.fullMulDiv(fee - ev, shareBps, BPS);
        rewardEpoch = currentEpoch();
        acquisitionRewards[requestId] =
            AcquisitionReward(purchaser, rewardEpoch, AcquisitionRewardStatus.Pending, slice);
        acquisitionSettledFee[requestId] = fee;
        pendingAcquisitionsInEpoch[rewardEpoch] += 1;
        lastAcquisitionTs = block.timestamp;
        emit AcquisitionRewardRegistered(requestId, purchaser, rewardEpoch, slice, shareBps);
    }

    function settleAcquisition(uint256 requestId) external payable onlyFWA {
        AcquisitionReward storage reward = acquisitionRewards[requestId];
        if (reward.status == AcquisitionRewardStatus.None) revert UnknownRequest();
        if (reward.status != AcquisitionRewardStatus.Pending) revert AcquisitionAlreadyTerminal();
        if (msg.value != reward.tokenSlice) revert IncorrectTokenSlice();
        reward.status = AcquisitionRewardStatus.Settled;
        uint64 epoch = reward.epoch;
        pendingAcquisitionsInEpoch[epoch] -= 1;
        acquisitionsInEpoch[epoch] += 1;
        userAcquisitionsInEpoch[epoch][reward.purchaser] += 1;
        uint256 settledFee = acquisitionSettledFee[requestId];
        settledHypeInEpoch[epoch] += settledFee;
        userSettledHypeInEpoch[epoch][reward.purchaser] += settledFee;
        if (reward.tokenSlice != 0) {
            tokenBuyAllowance[reward.purchaser] += reward.tokenSlice;
            tokenBuyAllowanceTotal += reward.tokenSlice;
        }
        _unlockSeasonal(requestId, epoch, settledFee);
        emit AcquisitionTokenAccrued(reward.purchaser, requestId, reward.tokenSlice);
    }

    function refundAcquisition(uint256 requestId) external onlyFWA {
        AcquisitionReward storage reward = acquisitionRewards[requestId];
        if (reward.status == AcquisitionRewardStatus.None) revert UnknownRequest();
        if (reward.status != AcquisitionRewardStatus.Pending) revert AcquisitionAlreadyTerminal();
        reward.status = AcquisitionRewardStatus.Refunded;
        pendingAcquisitionsInEpoch[reward.epoch] -= 1;
        emit AcquisitionRewardRefunded(requestId, reward.epoch);
    }

    function startEmission() external onlyFWA {
        if (emissionStart != 0) return;
        if (!emissionConfigured) revert EmissionNotConfigured();
        if (SafeTransferLib.balanceOf(token, address(this)) < tokenLiability) revert InsufficientFunding();
        emissionStart = block.timestamp;
        lastTokenAccrual = block.timestamp;
        emit EmissionStarted(block.timestamp);
    }

    function currentEpoch() public view returns (uint64) {
        uint256 start = emissionStart;
        if (start == 0 || block.timestamp <= start) return 0;
        return uint64((block.timestamp - start) / EPOCH_DURATION);
    }

    function currentSeason() public view returns (uint8) {
        uint256 epoch = currentEpoch();
        if (emissionStart == 0 || epoch >= EMISSION_DAYS) return 0;
        return uint8(epoch / SEASON_EPOCHS + 1);
    }

    function seasonBudget(uint256 season) public pure returns (uint256) {
        if (season == 0) return 50_000_000 ether;
        if (season == 1) return 30_000_000 ether;
        if (season == 2) return 20_000_000 ether;
        return 0;
    }

    function seasonEpochCap(uint256 epoch) public pure returns (uint256 cap) {
        if (epoch >= EMISSION_DAYS) return 0;
        uint256 budget = seasonBudget(epoch / SEASON_EPOCHS);
        cap = budget / SEASON_EPOCHS;
        if (epoch % SEASON_EPOCHS == SEASON_EPOCHS - 1) cap += budget - cap * SEASON_EPOCHS;
    }

    function effectiveSeasonQuoteX96() public view returns (uint256) {
        uint256 launchQuote;
        uint256 currentQuote;
        try IHWASeasonPrice(token).launchHwaPerHypeX96() returns (uint256 value) {
            launchQuote = value;
        } catch {
            return 0;
        }
        try IHWASeasonPrice(token).twapHwaPerHypeX96() returns (uint256 value) {
            currentQuote = value;
        } catch {
            return 0;
        }
        if (launchQuote == 0 || currentQuote == 0) return 0;
        return currentQuote < launchQuote ? currentQuote : launchQuote;
    }

    function _unlockSeasonal(uint256 requestId, uint256 epoch, uint256 settledFee) internal {
        if (emissionStart == 0 || epoch >= EMISSION_DAYS || epochFinalized[epoch]) return;
        uint256 quote = effectiveSeasonQuoteX96();
        if (quote == 0) return;
        uint256 valueCapHype = FixedPointMathLib.fullMulDiv(settledFee, VALUE_CAP_BPS, BPS);
        uint256 amount = FixedPointMathLib.fullMulDiv(valueCapHype, quote, Q96);
        uint256 cap = seasonEpochCap(epoch);
        uint256 emitted = epochSeasonalEmitted[epoch];
        if (amount > cap - emitted) amount = cap - emitted;
        uint256 reserve = seasonalReserveRemaining;
        if (amount > reserve) amount = reserve;
        if (amount == 0) return;
        uint256 depositorAmount = amount / 2;
        uint256 purchaserAmount = amount - depositorAmount;
        epochSeasonalEmitted[epoch] = emitted + amount;
        seasonalReserveRemaining = reserve - amount;
        seasonalEmitted += amount;
        seasonalDepositorEmitted += depositorAmount;
        seasonalPurchaserEmitted += purchaserAmount;
        depositorEmissionRemaining = seasonalReserveRemaining / 2;
        if (depositorAmount != 0) {
            uint256 total = seasonalSqrtBackingTotal;
            if (total == 0) {
                tokenLiability -= depositorAmount;
                seasonalBurned += depositorAmount;
                ITokenBurnable(token).burn(depositorAmount);
                depositorAmount = 0;
            } else {
                accSeasonalTokenPerSqrt += depositorAmount * SCALE / total;
            }
        }
        if (purchaserAmount != 0) purchaserSeasonalEpochPot[epoch] += purchaserAmount;
        emit SeasonalValueUnlocked(requestId, epoch, settledFee, quote, depositorAmount, purchaserAmount);
    }

    function finalizeEpoch(uint256 epoch) public returns (uint256 burned) {
        if (epoch >= EMISSION_DAYS || epoch >= currentEpoch()) revert EpochNotClosed();
        if (pendingAcquisitionsInEpoch[epoch] != 0) revert EpochStillPending();
        if (epochFinalized[epoch]) revert AlreadyClaimed();
        epochFinalized[epoch] = true;
        burned = seasonEpochCap(epoch) - epochSeasonalEmitted[epoch];
        if (burned > seasonalReserveRemaining) burned = seasonalReserveRemaining;
        if (burned != 0) {
            seasonalReserveRemaining -= burned;
            depositorEmissionRemaining = seasonalReserveRemaining / 2;
            seasonalBurned += burned;
            tokenLiability -= burned;
            ITokenBurnable(token).burn(burned);
        }
        emit EpochFinalized(epoch, epochSeasonalEmitted[epoch], burned);
    }

    function tokenShareBps(uint256 gap) public view returns (uint256) {
        if (gap <= hotGap) return 0;
        if (gap >= coldGap) return BPS;
        return BPS * (gap - hotGap) / (coldGap - hotGap);
    }

    function _pendingToken(uint256 listingId, ListingReward storage reward) internal view returns (uint256) {
        uint256 buybackAccrued = reward.sqrtBacking * accTokenPerSqrt / SCALE;
        uint256 pending = buybackAccrued > reward.tokenDebt ? buybackAccrued - reward.tokenDebt : 0;
        if (seasonalListingEligible[listingId]) {
            uint256 seasonalAccrued = reward.sqrtBacking * accSeasonalTokenPerSqrt / SCALE;
            uint256 debt = seasonalTokenDebt[listingId];
            if (seasonalAccrued > debt) pending += seasonalAccrued - debt;
        }
        return pending;
    }

    function _creditPending(uint256 listingId, ListingReward storage reward) internal {
        uint256 pending = _pendingToken(listingId, reward);
        if (pending != 0) {
            tokenCredit[reward.depositor] += pending;
            emit DepositorTokensAccrued(reward.depositor, listingId, pending);
        }
    }

    function pendingDepositorTokens(uint256 listingId) external view returns (uint256) {
        ListingReward storage reward = listingRewards[listingId];
        return reward.active ? _pendingToken(listingId, reward) : 0;
    }

    function claimAccruedTokens(uint256 minOut) external nonReentrant whenClaimsEnabled returns (uint256 tokenOut) {
        uint256 amount = tokenBuyAllowance[msg.sender];
        if (amount == 0) revert NoTokenReward();
        tokenBuyAllowance[msg.sender] = 0;
        tokenBuyAllowanceTotal -= amount;
        tokenOut = _buyTokens(amount, minOut);
        SafeTransferLib.safeTransfer(token, msg.sender, tokenOut);
        emit AccruedTokensClaimed(msg.sender, amount, tokenOut);
    }

    function withdrawTokenBuyAllowanceAsETH() external nonReentrant returns (uint256 amount) {
        address core = fwa;
        if (core == address(0) || !IFWARewardsCore(core).canRescueRewards()) revert RescueNotAllowed();
        amount = tokenBuyAllowance[msg.sender];
        if (amount == 0) revert NoTokenReward();
        tokenBuyAllowance[msg.sender] = 0;
        tokenBuyAllowanceTotal -= amount;
        SafeTransferLib.forceSafeTransferETH(msg.sender, amount);
        emit TokenBuyAllowanceWithdrawn(msg.sender, amount);
    }

    function claimDepositorTokens(uint256[] calldata listingIds)
        external
        nonReentrant
        whenClaimsEnabled
        returns (uint256 total)
    {
        for (uint256 i; i < listingIds.length; ++i) {
            uint256 listingId = listingIds[i];
            ListingReward storage reward = listingRewards[listingId];
            if (!reward.active) revert ListingNotActive();
            if (reward.depositor != msg.sender) revert NotDepositor();
            uint256 pending = _pendingToken(listingId, reward);
            reward.tokenDebt = reward.sqrtBacking * accTokenPerSqrt / SCALE;
            if (seasonalListingEligible[listingId]) {
                seasonalTokenDebt[listingId] = reward.sqrtBacking * accSeasonalTokenPerSqrt / SCALE;
            }
            total += pending;
            if (pending != 0) emit DepositorTokensAccrued(msg.sender, listingId, pending);
        }
        if (total == 0) revert NoTokenReward();
        tokenLiability -= total;
        SafeTransferLib.safeTransfer(token, msg.sender, total);
    }

    function withdrawTokens() external nonReentrant whenClaimsEnabled returns (uint256 amount) {
        amount = tokenCredit[msg.sender];
        if (amount == 0) revert NoTokenReward();
        tokenCredit[msg.sender] = 0;
        tokenLiability -= amount;
        SafeTransferLib.safeTransfer(token, msg.sender, amount);
        emit TokensWithdrawn(msg.sender, amount);
    }

    function claimEpochTokens(uint256[] calldata epochs)
        external
        nonReentrant
        whenClaimsEnabled
        returns (uint256 total)
    {
        uint256 current = currentEpoch();
        for (uint256 i; i < epochs.length; ++i) {
            uint256 epoch = epochs[i];
            if (epoch >= current) revert EpochNotClosed();
            if (pendingAcquisitionsInEpoch[epoch] != 0) revert EpochStillPending();
            if (epoch < EMISSION_DAYS && !epochFinalized[epoch]) revert EpochStillPending();
            if (purchaserEpochSwept[epoch] || purchaserClaimed[epoch][msg.sender]) revert AlreadyClaimed();
            uint256 mine = userSettledHypeInEpoch[epoch][msg.sender];
            uint256 totalWeight = settledHypeInEpoch[epoch];
            if (mine == 0 || totalWeight == 0) continue;
            purchaserClaimed[epoch][msg.sender] = true;
            uint256 amount = FixedPointMathLib.fullMulDiv(purchaserEpochAmount(epoch), mine, totalWeight);
            total += amount;
            emit PurchaserTokensClaimed(msg.sender, epoch, amount);
        }
        if (total == 0) revert NoTokenReward();
        tokenLiability -= total;
        SafeTransferLib.safeTransfer(token, msg.sender, total);
    }

    function purchaserEpochAmount(uint256 epoch) public view returns (uint256) {
        return purchaserEpochPot[epoch] + purchaserSeasonalEpochPot[epoch];
    }

    function buyFor(address recipient, uint256 minOut)
        external
        payable
        onlyFWA
        nonReentrant
        returns (uint256 tokenOut)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (msg.value == 0) revert NoTokenReward();
        tokenOut = _buyTokens(msg.value, minOut);
        SafeTransferLib.safeTransfer(token, recipient, tokenOut);
    }

    function _buyTokens(uint256 ethIn, uint256 minOut) internal returns (uint256 tokenOut) {
        tokenOut = swapAdapter.buyExactInput{value: ethIn}(minOut, 0);
        if (tokenOut == 0) revert NoTokenReward();
    }

    function onTokenReceived(uint256 depositorAmt, uint256 purchaserAmt) external {
        if (msg.sender != token) revert NotToken();
        if (depositorAmt != 0) {
            if (sqrtBackingTotal == 0) {
                ITokenBurnable(token).burn(depositorAmt);
            } else {
                accTokenPerSqrt += depositorAmt * SCALE / sqrtBackingTotal;
                tokenLiability += depositorAmt;
                buybackDepositorRouted += depositorAmt;
                emit ProtocolTokensRedistributed(depositorAmt);
            }
        }
        if (purchaserAmt != 0) {
            if (emissionStart == 0) {
                ITokenBurnable(token).burn(purchaserAmt);
            } else {
                uint64 epoch = currentEpoch();
                purchaserEpochPot[epoch] += purchaserAmt;
                tokenLiability += purchaserAmt;
                buybackPurchaserRouted += purchaserAmt;
                emit PurchaserTokensRouted(epoch, purchaserAmt);
            }
        }
    }

    function setEmission(uint256 depositorTotal, uint256 purchaserTotal) external onlyOwner {
        if (emissionStart != 0 || emissionConfigured) revert EmissionAlreadyStarted();
        if (depositorTotal != DEPOSITOR_SEASONAL_RESERVE || purchaserTotal != PURCHASER_SEASONAL_RESERVE) {
            revert InvalidConfig();
        }
        depositorRatePerSec = depositorTotal / EMISSION_DURATION;
        purchaserDailyPot = seasonEpochCap(0) / 2;
        depositorEmissionRemaining = depositorTotal;
        seasonalReserveRemaining = depositorTotal + purchaserTotal;
        tokenLiability = seasonalReserveRemaining;
        emissionConfigured = true;
        emit EmissionConfigured(depositorRatePerSec, purchaserDailyPot);
    }

    function enableClaims() external onlyOwner {
        if (claimsEnabled) revert AlreadyClaimed();
        claimsEnabled = true;
        emit ClaimsEnabled();
    }

    function setColdGapBands(uint256 hot, uint256 cold) external onlyOwner {
        if (hot >= cold) revert InvalidConfig();
        hotGap = hot;
        coldGap = cold;
        emit ColdGapBandsUpdated(hot, cold);
    }

    function setForcedTokenShareBps(int256 bps) external onlyOwner {
        if (bps < -1 || bps > int256(BPS)) revert InvalidConfig();
        forcedTokenShareBps = bps;
        emit ForcedTokenShareBpsUpdated(bps);
    }

    function sweepEmptyEpoch(uint256 epoch, address) external onlyOwner returns (uint256 amount) {
        if (epoch >= currentEpoch()) revert EpochNotClosed();
        if (pendingAcquisitionsInEpoch[epoch] != 0) revert EpochStillPending();
        if (purchaserEpochSwept[epoch]) revert AlreadyClaimed();
        if (epoch < EMISSION_DAYS && !epochFinalized[epoch]) finalizeEpoch(epoch);
        if (settledHypeInEpoch[epoch] != 0) revert EpochNotEmpty();
        purchaserEpochSwept[epoch] = true;
        amount = purchaserEpochAmount(epoch);
        if (amount != 0) {
            tokenLiability -= amount;
            ITokenBurnable(token).burn(amount);
        }
        emit EmptyEpochBurned(epoch, amount);
        emit EmptyEpochSwept(epoch, address(0), amount);
    }

    function rescueTokens(address to) external onlyOwner returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        address core = fwa;
        if (core == address(0) || !IFWARewardsCore(core).canRescueRewards()) revert RescueNotAllowed();
        uint256 balance = SafeTransferLib.balanceOf(token, address(this));
        if (balance > tokenLiability) amount = balance - tokenLiability;
        if (amount != 0) SafeTransferLib.safeTransfer(token, to, amount);
        emit TokensRescued(to, amount);
    }

    function _ceilDiv(uint256 x, uint256 y) internal pure returns (uint256) {
        return x == 0 ? 0 : (x - 1) / y + 1;
    }
}
