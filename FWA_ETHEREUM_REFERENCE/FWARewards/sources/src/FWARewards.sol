// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

import {POOL_LP_FEE, POOL_TICK_SPACING} from "./FWAToken.sol";

interface ITokenBurnable {
    function burn(uint256 amount) external;
}

interface IFWARewardsCore {
    function canRescueRewards() external view returns (bool);
}

/// @notice Core-facing interface. FWA remains responsible for NFT custody, acquisition escrow,
///         and selection; this module owns only FWAToken rewards and the ETH earmarked for token buys.
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

/// @title FWARewards
/// @notice Isolated FWAToken reward, emission, and swap module for FWA.
/// @dev The owner wires exactly one FWA with `setFWA`. After that, only FWA may mutate listing and
///      acquisition accounting. Participant claims remain permissionless pull paths and never run in
///      FWA's ordered acquisition processor.
contract FWARewards is Ownable, ReentrancyGuard, IUnlockCallback, IFWARewards {
    using CurrencySettler for Currency;

    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    uint256 public constant BPS = 10_000;
    uint256 internal constant SCALE = 1e36;
    uint256 public constant EMISSION_DAYS = 15;
    uint256 public constant EMISSION_DURATION = EMISSION_DAYS * 1 days;

    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

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

    /*//////////////////////////////////////////////////////////////
                              IMMUTABLES
    //////////////////////////////////////////////////////////////*/

    address public immutable token;
    IPoolManager public immutable tokenPoolManager;
    address public immutable tokenHook;

    /*//////////////////////////////////////////////////////////////
                              CORE WIRING
    //////////////////////////////////////////////////////////////*/

    /// @notice The sole FWA allowed to create reward liabilities. Set exactly once.
    address public fwa;

    /*//////////////////////////////////////////////////////////////
                         LISTING EMISSION STATE
    //////////////////////////////////////////////////////////////*/

    mapping(uint256 listingId => ListingReward reward) public listingRewards;

    /// @notice Sum of sqrt(backing) across active listings.
    uint256 public sqrtBackingTotal;
    /// @notice Accumulated FWAToken per unit of sqrt(backing), scaled by 1e36.
    uint256 public accTokenPerSqrt;
    /// @notice Last timestamp incorporated into the accumulator.
    uint256 public lastTokenAccrual;
    /// @notice Fixed depositor emission per second during the initial emission window.
    uint256 public depositorRatePerSec;
    /// @notice Settled listing rewards awaiting withdrawal by their depositor.
    mapping(address depositor => uint256 amount) public tokenCredit;

    /*//////////////////////////////////////////////////////////////
                       PURCHASER BUY ALLOWANCES
    //////////////////////////////////////////////////////////////*/

    /// @notice ETH from successful acquisitions earmarked for a purchaser's token buy.
    mapping(address purchaser => uint256 ethOwed) public tokenBuyAllowance;
    /// @notice Aggregate ETH liability represented by `tokenBuyAllowance`.
    uint256 public tokenBuyAllowanceTotal;

    /// @notice A request's committed surcharge slice and request-time reward epoch.
    mapping(uint256 requestId => AcquisitionReward reward) public acquisitionRewards;

    /// @notice Cold-gap curve: zero token share at/below hotGap and full share at/above coldGap.
    uint256 public hotGap = 60;
    uint256 public coldGap = 3600;
    /// @notice -1 selects the dynamic curve; [0, BPS] forces a static share.
    int256 public forcedTokenShareBps = -1;
    uint256 public lastAcquisitionTs;

    /*//////////////////////////////////////////////////////////////
                         PURCHASER EPOCH STATE
    //////////////////////////////////////////////////////////////*/

    uint256 public emissionStart;
    uint256 public purchaserDailyPot;

    /// @notice Additional buyback-funded pot for each epoch.
    mapping(uint256 epoch => uint256 amount) public purchaserEpochPot;
    mapping(uint256 epoch => uint256 acquisitions) public acquisitionsInEpoch;
    mapping(uint256 epoch => mapping(address purchaser => uint256 acquisitions)) public userAcquisitionsInEpoch;

    /// @notice Requests assigned to an epoch but not terminal. Claims and empty sweeps wait for zero.
    mapping(uint256 epoch => uint256 acquisitions) public pendingAcquisitionsInEpoch;
    mapping(uint256 epoch => mapping(address purchaser => bool claimed)) public purchaserClaimed;
    mapping(uint256 epoch => bool swept) public purchaserEpochSwept;

    /*//////////////////////////////////////////////////////////////
                              SWAP STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice Raised only across this module's PoolManager swap. FWATokenHook reads it while buys
    ///         are otherwise gated.
    bool public isBuying;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

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

    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

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
    error TokenNotConfigured();
    error NoTokenReward();
    error EmissionAlreadyStarted();
    error EpochNotClosed();
    error EpochStillPending();
    error EpochNotEmpty();
    error AlreadyClaimed();
    error SlippageBuy();
    error PartialFill();
    error NotPoolManager();
    error NotToken();
    error RescueNotAllowed();

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(address token_, IPoolManager poolManager_, address hook_, address owner_) {
        if (token_ == address(0) || address(poolManager_) == address(0) || hook_ == address(0) || owner_ == address(0))
        {
            revert ZeroAddress();
        }

        token = token_;
        tokenPoolManager = poolManager_;
        tokenHook = hook_;
        _initializeOwner(owner_);
    }

    modifier onlyFWA() {
        if (msg.sender != fwa) revert OnlyFWA();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              CORE WIRING
    //////////////////////////////////////////////////////////////*/

    /// @notice Bind the module to its core FWA. This cannot be rotated: migration deploys a new
    ///         module so stale and replacement pools cannot both create liabilities here.
    function setFWA(address fwa_) external onlyOwner {
        if (fwa_ == address(0)) revert ZeroAddress();
        if (fwa != address(0)) revert FWAAlreadySet();
        fwa = fwa_;
        emit FWASet(fwa_);
    }

    /*//////////////////////////////////////////////////////////////
                        LISTING ACCOUNTING HOOKS
    //////////////////////////////////////////////////////////////*/

    function onListingActivated(uint256 listingId, address depositor, uint256 backing) external onlyFWA {
        if (depositor == address(0) || backing == 0) revert InvalidConfig();

        ListingReward storage reward = listingRewards[listingId];
        if (reward.active) revert ListingAlreadyActive();

        _advanceToken();
        uint256 sqrtBacking = FixedPointMathLib.sqrt(backing);
        reward.depositor = depositor;
        reward.active = true;
        reward.sqrtBacking = sqrtBacking;
        // Ceil the join checkpoint so a new listing can never claim pre-activation rounding dust.
        reward.tokenDebt = _ceilDiv(sqrtBacking * accTokenPerSqrt, SCALE);
        sqrtBackingTotal += sqrtBacking;

        emit ListingRewardActivated(listingId, depositor, backing, sqrtBacking);
    }

    function onListingRepriced(uint256 listingId, uint256 backing) external onlyFWA {
        ListingReward storage reward = listingRewards[listingId];
        if (!reward.active) revert ListingNotActive();

        _advanceToken();
        _creditPending(listingId, reward);

        uint256 oldSqrtBacking = reward.sqrtBacking;
        uint256 newSqrtBacking = FixedPointMathLib.sqrt(backing);
        sqrtBackingTotal = sqrtBackingTotal - oldSqrtBacking + newSqrtBacking;
        reward.sqrtBacking = newSqrtBacking;
        reward.tokenDebt = _ceilDiv(newSqrtBacking * accTokenPerSqrt, SCALE);

        emit ListingRewardRepriced(listingId, backing, newSqrtBacking);
    }

    function onListingRemoved(uint256 listingId) external onlyFWA {
        ListingReward storage reward = listingRewards[listingId];
        if (!reward.active) revert ListingNotActive();

        _advanceToken();
        _creditPending(listingId, reward);

        address depositor = reward.depositor;
        sqrtBackingTotal -= reward.sqrtBacking;
        delete listingRewards[listingId];

        emit ListingRewardRemoved(listingId, depositor);
    }

    /*//////////////////////////////////////////////////////////////
                      ACQUISITION ACCOUNTING HOOKS
    //////////////////////////////////////////////////////////////*/

    /// @notice Commit the purchaser's request-time epoch and potential token-buy slice. No ETH is
    ///         transferred yet: FWA keeps the entire acquisition fee escrowed until ordered settlement.
    function registerAcquisition(uint256 requestId, address purchaser, uint256 fee, uint256 surchargeBps)
        external
        onlyFWA
        returns (uint256 slice, uint64 rewardEpoch)
    {
        if (purchaser == address(0) || surchargeBps > type(uint256).max - BPS) revert InvalidConfig();
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

        acquisitionRewards[requestId] = AcquisitionReward({
            purchaser: purchaser,
            epoch: rewardEpoch,
            status: AcquisitionRewardStatus.Pending,
            tokenSlice: slice
        });
        pendingAcquisitionsInEpoch[rewardEpoch] += 1;
        lastAcquisitionTs = block.timestamp;

        emit AcquisitionRewardRegistered(requestId, purchaser, rewardEpoch, slice, shareBps);
    }

    /// @notice Terminal success hook. FWA forwards exactly the committed slice out of acquisition
    ///         escrow; it becomes a pull-based ETH allowance and the request earns one epoch unit.
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

        uint256 slice = reward.tokenSlice;
        if (slice != 0) {
            tokenBuyAllowance[reward.purchaser] += slice;
            tokenBuyAllowanceTotal += slice;
        }

        emit AcquisitionTokenAccrued(reward.purchaser, requestId, slice);
    }

    /// @notice Terminal non-success hook shared by expiration, no-listing, and slippage refunds.
    function refundAcquisition(uint256 requestId) external onlyFWA {
        AcquisitionReward storage reward = acquisitionRewards[requestId];
        if (reward.status == AcquisitionRewardStatus.None) revert UnknownRequest();
        if (reward.status != AcquisitionRewardStatus.Pending) revert AcquisitionAlreadyTerminal();

        reward.status = AcquisitionRewardStatus.Refunded;
        pendingAcquisitionsInEpoch[reward.epoch] -= 1;
        emit AcquisitionRewardRefunded(requestId, reward.epoch);
    }

    /*//////////////////////////////////////////////////////////////
                         EMISSION ACCOUNTING
    //////////////////////////////////////////////////////////////*/

    /// @notice Begin the fixed 15-day emissions when FWA first enables acquisitions. Repeated calls
    ///         are harmless so toggling acquisitions off and back on does not break the core.
    function startEmission() external onlyFWA {
        if (emissionStart != 0) return;
        emissionStart = block.timestamp;
        lastTokenAccrual = block.timestamp;
        emit EmissionStarted(block.timestamp);
    }

    function currentEpoch() public view returns (uint64) {
        uint256 start = emissionStart;
        if (start == 0 || block.timestamp <= start) return 0;
        return uint64((block.timestamp - start) / 1 days);
    }

    /// @notice Fraction of acquisition surcharge routed to a purchaser token buy for `gap` seconds.
    function tokenShareBps(uint256 gap) public view returns (uint256) {
        uint256 hot = hotGap;
        uint256 cold = coldGap;
        if (gap <= hot) return 0;
        if (gap >= cold) return BPS;
        return BPS * (gap - hot) / (cold - hot);
    }

    function _advanceToken() internal {
        uint256 start = emissionStart;
        if (start == 0) return;

        uint256 end = start + EMISSION_DURATION;
        uint256 cappedNow = block.timestamp < end ? block.timestamp : end;
        uint256 last = lastTokenAccrual;
        if (cappedNow <= last) return;

        uint256 total = sqrtBackingTotal;
        if (total != 0 && depositorRatePerSec != 0) {
            accTokenPerSqrt += depositorRatePerSec * (cappedNow - last) * SCALE / total;
        }
        lastTokenAccrual = cappedNow;
    }

    function _pendingToken(ListingReward storage reward) internal view returns (uint256) {
        uint256 accrued = reward.sqrtBacking * accTokenPerSqrt / SCALE;
        return accrued > reward.tokenDebt ? accrued - reward.tokenDebt : 0;
    }

    function _creditPending(uint256 listingId, ListingReward storage reward) internal {
        uint256 pending = _pendingToken(reward);
        if (pending == 0) return;

        tokenCredit[reward.depositor] += pending;
        emit DepositorTokensAccrued(reward.depositor, listingId, pending);
    }

    /// @notice Simulate the accumulator advance and return one active listing's unsettled reward.
    function pendingDepositorTokens(uint256 listingId) external view returns (uint256) {
        ListingReward storage reward = listingRewards[listingId];
        if (!reward.active) return 0;

        uint256 acc = accTokenPerSqrt;
        uint256 start = emissionStart;
        if (start != 0) {
            uint256 end = start + EMISSION_DURATION;
            uint256 cappedNow = block.timestamp < end ? block.timestamp : end;
            uint256 total = sqrtBackingTotal;
            if (cappedNow > lastTokenAccrual && total != 0 && depositorRatePerSec != 0) {
                acc += depositorRatePerSec * (cappedNow - lastTokenAccrual) * SCALE / total;
            }
        }

        uint256 accrued = reward.sqrtBacking * acc / SCALE;
        return accrued > reward.tokenDebt ? accrued - reward.tokenDebt : 0;
    }

    /*//////////////////////////////////////////////////////////////
                             TOKEN CLAIMS
    //////////////////////////////////////////////////////////////*/

    /// @notice Spend the caller's successful-acquisition allowance buying FWAToken for the caller.
    function claimAccruedTokens(uint256 minOut) external nonReentrant returns (uint256 tokenOut) {
        uint256 amount = tokenBuyAllowance[msg.sender];
        if (amount == 0) revert NoTokenReward();

        tokenBuyAllowance[msg.sender] = 0;
        tokenBuyAllowanceTotal -= amount;
        tokenOut = _buyTokens(amount, minOut);
        SafeTransferLib.safeTransfer(token, msg.sender, tokenOut);

        emit AccruedTokensClaimed(msg.sender, amount, tokenOut);
    }

    /// @notice Emergency ETH exit for an otherwise unspendable purchaser allowance. It is available
    ///         only while the bound FWA is in withdraw-only mode with no unsettled acquisition, the
    ///         same fail-safe condition used for migration rescue. Normal operation therefore keeps
    ///         the surcharge committed to FWAToken buy pressure.
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

    /// @notice Harvest unsettled rewards from active listings owned by the caller.
    function claimDepositorTokens(uint256[] calldata listingIds) external nonReentrant returns (uint256 total) {
        _advanceToken();

        for (uint256 i; i < listingIds.length; ++i) {
            uint256 listingId = listingIds[i];
            ListingReward storage reward = listingRewards[listingId];
            if (!reward.active) revert ListingNotActive();
            if (reward.depositor != msg.sender) revert NotDepositor();

            uint256 pending = _pendingToken(reward);
            if (pending == 0) continue;

            reward.tokenDebt = reward.sqrtBacking * accTokenPerSqrt / SCALE;
            total += pending;
            emit DepositorTokensAccrued(msg.sender, listingId, pending);
        }

        if (total == 0) revert NoTokenReward();
        SafeTransferLib.safeTransfer(token, msg.sender, total);
    }

    /// @notice Withdraw rewards settled into credit when a listing was repriced or removed.
    function withdrawTokens() external nonReentrant returns (uint256 amount) {
        amount = tokenCredit[msg.sender];
        if (amount == 0) revert NoTokenReward();

        tokenCredit[msg.sender] = 0;
        SafeTransferLib.safeTransfer(token, msg.sender, amount);
        emit TokensWithdrawn(msg.sender, amount);
    }

    /// @notice Claim the caller's pro-rata share of one or more closed request-time epochs.
    function claimEpochTokens(uint256[] calldata epochs) external nonReentrant returns (uint256 total) {
        uint256 current = currentEpoch();

        for (uint256 i; i < epochs.length; ++i) {
            uint256 epoch = epochs[i];
            if (epoch >= current) revert EpochNotClosed();
            if (pendingAcquisitionsInEpoch[epoch] != 0) revert EpochStillPending();
            if (purchaserEpochSwept[epoch] || purchaserClaimed[epoch][msg.sender]) revert AlreadyClaimed();

            uint256 mine = userAcquisitionsInEpoch[epoch][msg.sender];
            if (mine == 0) continue;

            purchaserClaimed[epoch][msg.sender] = true;
            uint256 amount = purchaserEpochAmount(epoch) * mine / acquisitionsInEpoch[epoch];
            total += amount;
            emit PurchaserTokensClaimed(msg.sender, epoch, amount);
        }

        if (total == 0) revert NoTokenReward();
        SafeTransferLib.safeTransfer(token, msg.sender, total);
    }

    function purchaserEpochAmount(uint256 epoch) public view returns (uint256) {
        return purchaserEpochPot[epoch] + (epoch < EMISSION_DAYS ? purchaserDailyPot : 0);
    }

    /*//////////////////////////////////////////////////////////////
                               TOKEN SWAPS
    //////////////////////////////////////////////////////////////*/

    /// @notice FWA-funded ETH -> FWAToken buy used by token-denominated settlement outcomes.
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

    function _tokenPoolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(token),
            fee: POOL_LP_FEE,
            tickSpacing: POOL_TICK_SPACING,
            hooks: IHooks(tokenHook)
        });
    }

    /// @dev Requires a full exact-input fill. This prevents partially consumed purchaser allowances
    ///      or FWA settlement ETH from becoming untracked contract balance at exhausted liquidity.
    function _buyTokens(uint256 ethIn, uint256 minOut) internal returns (uint256 tokenOut) {
        uint256 ethSpent;
        (tokenOut, ethSpent) = abi.decode(tokenPoolManager.unlock(abi.encode(ethIn, minOut)), (uint256, uint256));
        if (ethSpent != ethIn) revert PartialFill();
        if (tokenOut == 0) revert NoTokenReward();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(tokenPoolManager)) revert NotPoolManager();
        (uint256 amountIn, uint256 minOut) = abi.decode(data, (uint256, uint256));

        PoolKey memory key = _tokenPoolKey();
        isBuying = true;
        BalanceDelta delta = tokenPoolManager.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            ""
        );
        isBuying = false;

        uint256 amountSpent = uint256(int256(-delta.amount0()));
        key.currency0.settle(tokenPoolManager, address(this), amountSpent, false);

        uint256 amountOut = uint256(int256(delta.amount1()));
        if (amountOut < minOut) revert SlippageBuy();
        if (amountOut != 0) key.currency1.take(tokenPoolManager, address(this), amountOut, false);

        return abi.encode(amountOut, amountSpent);
    }

    /*//////////////////////////////////////////////////////////////
                        BUYBACK TOKEN CALLBACK
    //////////////////////////////////////////////////////////////*/

    /// @notice Route FWAToken transferred by `FWAToken.buyback` into depositor and purchaser rewards.
    function onTokenReceived(uint256 depositorAmt, uint256 purchaserAmt) external {
        if (msg.sender != token) revert NotToken();

        if (depositorAmt != 0) {
            uint256 total = sqrtBackingTotal;
            if (total == 0) {
                ITokenBurnable(token).burn(depositorAmt);
            } else {
                _advanceToken();
                accTokenPerSqrt += depositorAmt * SCALE / total;
                emit ProtocolTokensRedistributed(depositorAmt);
            }
        }

        if (purchaserAmt != 0) {
            uint64 epoch = currentEpoch();
            purchaserEpochPot[epoch] += purchaserAmt;
            emit PurchaserTokensRouted(epoch, purchaserAmt);
        }
    }

    /*//////////////////////////////////////////////////////////////
                              OWNER CONFIG
    //////////////////////////////////////////////////////////////*/

    /// @notice Configure the two fixed emission buckets before emission starts. The module must be
    ///         funded separately with enough FWAToken to honor the resulting claims.
    function setEmission(uint256 depositorTotal, uint256 purchaserTotal) external onlyOwner {
        if (emissionStart != 0) revert EmissionAlreadyStarted();
        depositorRatePerSec = depositorTotal / EMISSION_DURATION;
        purchaserDailyPot = purchaserTotal / EMISSION_DAYS;
        emit EmissionConfigured(depositorRatePerSec, purchaserDailyPot);
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

    function sweepEmptyEpoch(uint256 epoch, address to) external onlyOwner returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        if (epoch >= currentEpoch()) revert EpochNotClosed();
        if (pendingAcquisitionsInEpoch[epoch] != 0) revert EpochStillPending();
        if (acquisitionsInEpoch[epoch] != 0) revert EpochNotEmpty();
        if (purchaserEpochSwept[epoch]) revert AlreadyClaimed();

        purchaserEpochSwept[epoch] = true;
        amount = purchaserEpochAmount(epoch);
        if (amount != 0) SafeTransferLib.safeTransfer(token, to, amount);
        emit EmptyEpochSwept(epoch, to, amount);
    }

    /// @notice Destructive migration escape hatch. As in the original FWA implementation, this
    ///         deliberately may leave old claims unfunded; operators should announce a claim window.
    function rescueTokens(address to) external onlyOwner returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        address core = fwa;
        if (core == address(0) || !IFWARewardsCore(core).canRescueRewards()) revert RescueNotAllowed();

        depositorRatePerSec = 0;
        purchaserDailyPot = 0;
        amount = SafeTransferLib.balanceOf(token, address(this));
        if (amount != 0) SafeTransferLib.safeTransfer(token, to, amount);
        emit TokensRescued(to, amount);
    }

    function _ceilDiv(uint256 x, uint256 y) internal pure returns (uint256) {
        return x == 0 ? 0 : (x - 1) / y + 1;
    }
}
