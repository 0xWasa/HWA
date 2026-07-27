// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/src/tokens/ERC20.sol";
import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {HWAProjectXLiquidityLocker} from "./HWAProjectXLiquidityLocker.sol";

import {IHyperSwapV3Factory, IHyperSwapV3Pool, IHyperSwapV3PositionManager} from "./interfaces/IHyperSwapV3.sol";

interface IFWAProtocolBuyAdapter {
    function TOKEN() external view returns (address);
    function WHYPE() external view returns (address);
    function POOL() external view returns (address);
    function POOL_FEE() external view returns (uint24);
    function TOKEN_BUYER() external view returns (address);
    function buyExactInput(uint256 minOut, uint160 sqrtPriceLimitX96) external payable returns (uint256 tokenOut);
}

interface IFWABuybackRouter {
    function onTokenReceived(uint256 depositorAmt, uint256 purchaserAmt) external;
}

/// @title FWATokenHyperEVM
/// @notice Fixed-supply Hyper World Assets (HWA) incentive token with a Project X V3 launch and buyback path.
/// @dev Project X uses the standard V3 surface. Chain 998 uses an ABI-equivalent compatibility venue.
///      There is deliberately no fee-on-transfer behavior.
contract FWATokenHyperEVM is ERC20, Ownable, ReentrancyGuard {
    uint24 public constant POOL_FEE = 10_000;
    int24 public constant POOL_TICK_SPACING = 200;

    uint256 public constant BUYBACK_INCREMENT = 1 ether;
    uint256 public constant BUYBACK_DELAY_BLOCKS = 1;
    uint256 public constant CALLER_REWARD_BPS = 50;
    uint32 public constant BUYBACK_TWAP_SECONDS = 30 minutes;
    uint16 public constant BUYBACK_OBSERVATION_CARDINALITY = 16;
    uint256 public constant BUYBACK_MIN_OUT_BPS = 9_000;
    uint256 private constant TOTAL_BIPS = 10_000;
    uint256 private constant BUYBACK_SQRT_LIMIT_BPS = 9_535;
    uint256 private constant V3_FEE_DENOMINATOR = 1_000_000;
    uint256 private constant Q96 = 1 << 96;
    int256 private constant V3_MIN_TICK = -887_272;
    int256 private constant V3_MAX_TICK = 887_272;

    uint160 private constant V3_MIN_SQRT_RATIO = 4_295_128_739;
    uint160 private constant V3_MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

    IHyperSwapV3Factory public immutable FACTORY;
    IHyperSwapV3PositionManager public immutable POSITION_MANAGER;
    address public immutable WHYPE;

    string private _tokenName;
    string private _tokenSymbol;

    address public pool;
    address public liquidityLocker;
    address public adapter;
    address public rewardsPool;
    uint256 public lpTokenId;
    bool public launched;
    bool public externalBuysEnabled;
    bool private _launching;

    mapping(address account => bool allowed) public isDistributor;
    mapping(address account => bool allowed) public isProtocolBuyer;

    uint256 public lastBuybackBlock;
    uint256 public routeDepositorBps = 4_000;
    uint256 public routePurchaserBps = 4_000;
    uint256 public routeBurnBps = 2_000;

    event DistributorSet(address indexed account, bool allowed);
    event ProtocolBuyerSet(address indexed account, bool allowed);
    event ExternalBuysEnabledSet(bool enabled);
    event MarketAdapterSet(address indexed adapter, address indexed pool);
    event RewardsPoolSet(address indexed rewardsPool);
    event RouteSplitSet(uint256 depBps, uint256 purchaserBps, uint256 burnBps);
    event BuybackBoundsUsed(
        uint160 currentSqrtPriceX96, uint160 twapSqrtPriceX96, uint160 sqrtPriceLimitX96, uint256 minOut
    );
    event Bought(address indexed caller, uint256 hypeSpent, uint256 amountBought, uint256 callerReward);
    event BuybackRouted(uint256 toDepositors, uint256 toPurchasers, uint256 burned);
    event Launched(
        address indexed pool,
        uint256 indexed lpTokenId,
        address indexed liquidityLocker,
        uint160 sqrtPriceX96,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 tokenSeeded
    );

    error InvalidAddress();
    error InvalidContract();
    error EmptyString();
    error InvalidTransfer();
    error NoHype();
    error DelayNotMet();
    error AlreadyLaunched();
    error NoLpSupply();
    error InvalidRange();
    error InvalidSplit();
    error MarketNotLaunched();
    error AdapterAlreadySet();
    error RewardsPoolAlreadySet();
    error InvalidAdapter();
    error MarketNotConfigured();
    error InvalidPoolConfiguration();
    error BuybackOracleNotReady();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply_,
        uint256 lpSupply_,
        address factory_,
        address positionManager_,
        address whype_,
        address owner_
    ) {
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0) revert EmptyString();
        if (factory_ == address(0) || positionManager_ == address(0) || whype_ == address(0) || owner_ == address(0)) {
            revert InvalidAddress();
        }
        if (factory_.code.length == 0 || positionManager_.code.length == 0 || whype_.code.length == 0) {
            revert InvalidContract();
        }
        if (supply_ == 0 || lpSupply_ > supply_) revert InvalidAddress();

        IHyperSwapV3Factory factoryContract = IHyperSwapV3Factory(factory_);
        IHyperSwapV3PositionManager positionManager = IHyperSwapV3PositionManager(positionManager_);
        if (positionManager.factory() != factory_ || positionManager.WETH9() != whype_) revert InvalidContract();
        if (factoryContract.feeAmountTickSpacing(POOL_FEE) != POOL_TICK_SPACING) revert InvalidContract();

        _tokenName = name_;
        _tokenSymbol = symbol_;
        FACTORY = factoryContract;
        POSITION_MANAGER = positionManager;
        WHYPE = whype_;
        _initializeOwner(owner_);

        if (lpSupply_ != 0) _mint(address(this), lpSupply_);
        if (supply_ - lpSupply_ != 0) _mint(owner_, supply_ - lpSupply_);
    }

    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    function setDistributor(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        isDistributor[account] = allowed;
        emit DistributorSet(account, allowed);
    }

    function setProtocolBuyer(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        isProtocolBuyer[account] = allowed;
        emit ProtocolBuyerSet(account, allowed);
    }

    function setExternalBuysEnabled(bool enabled) external onlyOwner {
        if (!launched) revert MarketNotLaunched();
        if (enabled) {
            if (adapter == address(0) || rewardsPool == address(0)) revert MarketNotConfigured();
            _assertLivePoolConfiguration();
        }
        externalBuysEnabled = enabled;
        emit ExternalBuysEnabledSet(enabled);
    }

    function setAdapter(address adapter_) external onlyOwner {
        if (!launched) revert MarketNotLaunched();
        if (adapter != address(0)) revert AdapterAlreadySet();
        if (adapter_ == address(0) || adapter_.code.length == 0) revert InvalidAdapter();

        IFWAProtocolBuyAdapter candidate = IFWAProtocolBuyAdapter(adapter_);
        if (
            candidate.TOKEN() != address(this) || candidate.TOKEN_BUYER() != address(this) || candidate.WHYPE() != WHYPE
                || candidate.POOL() != pool || candidate.POOL_FEE() != POOL_FEE
        ) revert InvalidAdapter();

        adapter = adapter_;
        isDistributor[adapter_] = true;
        emit DistributorSet(adapter_, true);
        emit MarketAdapterSet(adapter_, pool);
    }

    function setRewardsPool(address rewardsPool_) external onlyOwner {
        if (rewardsPool != address(0)) revert RewardsPoolAlreadySet();
        if (rewardsPool_ == address(0) || rewardsPool_.code.length == 0) revert InvalidContract();
        rewardsPool = rewardsPool_;
        isDistributor[rewardsPool_] = true;
        isProtocolBuyer[rewardsPool_] = true;
        emit DistributorSet(rewardsPool_, true);
        emit ProtocolBuyerSet(rewardsPool_, true);
        emit RewardsPoolSet(rewardsPool_);
    }

    function setRouteSplit(uint256 depBps, uint256 purchaserBps, uint256 burnBps) external onlyOwner {
        if (depBps + purchaserBps + burnBps != TOTAL_BIPS) revert InvalidSplit();
        routeDepositorBps = depBps;
        routePurchaserBps = purchaserBps;
        routeBurnBps = burnBps;
        emit RouteSplitSet(depBps, purchaserBps, burnBps);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Initialize the 1% wHYPE/HWA pool and mint the one-sided launch position into its permanent locker.
    function launch(uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, address liquidityLocker_)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokenId, uint128 liquidity, uint256 tokenSeeded)
    {
        if (launched) revert AlreadyLaunched();
        if (liquidityLocker_ == address(0) || liquidityLocker_.code.length == 0) revert InvalidAddress();
        HWAProjectXLiquidityLocker locker = HWAProjectXLiquidityLocker(liquidityLocker_);
        if (
            address(locker.POSITION_MANAGER()) != address(POSITION_MANAGER) || locker.CONTROLLER() != address(this)
                || locker.bound()
        ) revert InvalidPoolConfiguration();
        uint256 tokenAmount = balanceOf(address(this));
        if (tokenAmount == 0) revert NoLpSupply();
        if (
            tickLower >= tickUpper || tickLower % POOL_TICK_SPACING != 0 || tickUpper % POOL_TICK_SPACING != 0
                || sqrtPriceX96 <= V3_MIN_SQRT_RATIO || sqrtPriceX96 >= V3_MAX_SQRT_RATIO
        ) revert InvalidRange();

        (address token0, address token1) = address(this) < WHYPE ? (address(this), WHYPE) : (WHYPE, address(this));
        bool hwaIsToken0 = token0 == address(this);
        if (hwaIsToken0) {
            if (sqrtPriceX96 > TickMath.getSqrtPriceAtTick(tickLower)) revert InvalidRange();
        } else if (sqrtPriceX96 < TickMath.getSqrtPriceAtTick(tickUpper)) {
            revert InvalidRange();
        }

        launched = true;
        address createdPool =
            POSITION_MANAGER.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sqrtPriceX96);
        if (createdPool == address(0) || createdPool != FACTORY.getPool(token0, token1, POOL_FEE)) {
            revert InvalidContract();
        }
        IHyperSwapV3Pool createdPoolContract = IHyperSwapV3Pool(createdPool);
        (uint160 initializedSqrtPriceX96,,,,,,) = createdPoolContract.slot0();
        if (
            createdPoolContract.token0() != token0 || createdPoolContract.token1() != token1
                || createdPoolContract.fee() != POOL_FEE || createdPoolContract.tickSpacing() != POOL_TICK_SPACING
                || initializedSqrtPriceX96 != sqrtPriceX96
        ) revert InvalidContract();
        pool = createdPool;
        liquidityLocker = liquidityLocker_;
        createdPoolContract.increaseObservationCardinalityNext(BUYBACK_OBSERVATION_CARDINALITY);

        _launching = true;
        _approve(address(this), address(POSITION_MANAGER), tokenAmount);
        uint256 amount0;
        uint256 amount1;
        (tokenId, liquidity, amount0, amount1) = POSITION_MANAGER.mint(
            IHyperSwapV3PositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: POOL_FEE,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: hwaIsToken0 ? tokenAmount : 0,
                amount1Desired: hwaIsToken0 ? 0 : tokenAmount,
                amount0Min: 0,
                amount1Min: 0,
                recipient: liquidityLocker_,
                deadline: block.timestamp
            })
        );
        _approve(address(this), address(POSITION_MANAGER), 0);
        _launching = false;

        tokenSeeded = hwaIsToken0 ? amount0 : amount1;
        if (tokenSeeded == 0 || liquidity == 0 || POSITION_MANAGER.ownerOf(tokenId) != liquidityLocker_) {
            revert InvalidPoolConfiguration();
        }
        locker.bind(tokenId);
        lpTokenId = tokenId;
        emit Launched(
            createdPool, tokenId, liquidityLocker_, sqrtPriceX96, tickLower, tickUpper, liquidity, tokenSeeded
        );
    }

    /// @notice Current V3 price limit for a HYPE -> HWA buy. It is rebased from spot every call,
    ///         so ordinary HWA appreciation cannot permanently disable the permissionless loop.
    function buybackSqrtPriceLimitX96() public view returns (uint160) {
        address marketPool = pool;
        if (marketPool == address(0)) return 0;
        (uint160 currentSqrtPriceX96,,,,,,) = IHyperSwapV3Pool(marketPool).slot0();
        return _relativePriceLimit(currentSqrtPriceX96);
    }

    /// @notice TWAP-derived minimum HWA per HYPE, encoded as X96 for release attestations.
    /// @dev Returns zero until the 30-minute oracle window is available; buyback itself fails closed.
    function buybackMinOutPerHypeX96() public view returns (uint256) {
        (bool ready, uint160 twapSqrtPriceX96) = _tryTwapSqrtPriceX96();
        if (!ready) return 0;
        uint256 oneHypeQuote = _quoteAtSqrtPrice(1 ether, twapSqrtPriceX96);
        uint256 minOut = oneHypeQuote * (V3_FEE_DENOMINATOR - POOL_FEE) / V3_FEE_DENOMINATOR;
        minOut = minOut * BUYBACK_MIN_OUT_BPS / TOTAL_BIPS;
        return FixedPointMathLib.fullMulDiv(minOut, Q96, 1 ether);
    }

    function buybackOracleReady() external view returns (bool ready) {
        (ready,) = _tryTwapSqrtPriceX96();
    }

    function quoteBuyback(uint256 hypeIn)
        public
        view
        returns (uint256 minOut, uint160 sqrtPriceLimitX96, uint160 currentSqrtPriceX96, uint160 twapSqrtPriceX96)
    {
        if (hypeIn == 0) {
            revert NoHype();
        }
        address marketPool = pool;
        if (marketPool == address(0)) revert MarketNotLaunched();
        (currentSqrtPriceX96,,,,,,) = IHyperSwapV3Pool(marketPool).slot0();
        (bool ready, uint160 observedSqrtPriceX96) = _tryTwapSqrtPriceX96();
        if (!ready) revert BuybackOracleNotReady();
        twapSqrtPriceX96 = observedSqrtPriceX96;
        sqrtPriceLimitX96 = _relativePriceLimit(currentSqrtPriceX96);

        minOut = _quoteAtSqrtPrice(hypeIn, twapSqrtPriceX96);
        minOut = minOut * (V3_FEE_DENOMINATOR - POOL_FEE) / V3_FEE_DENOMINATOR;
        minOut = minOut * BUYBACK_MIN_OUT_BPS / TOTAL_BIPS;
        if (minOut == 0) revert InvalidRange();
    }

    function buyback() external nonReentrant returns (uint256 amountOut) {
        if (block.number < lastBuybackBlock + BUYBACK_DELAY_BLOCKS) revert DelayNotMet();
        address marketAdapter = adapter;
        if (marketAdapter == address(0)) revert InvalidAdapter();

        uint256 available = address(this).balance;
        if (available == 0) revert NoHype();

        uint256 slice = available < BUYBACK_INCREMENT ? available : BUYBACK_INCREMENT;
        uint256 incentive = slice * CALLER_REWARD_BPS / TOTAL_BIPS;
        uint256 buyAmount = slice - incentive;
        lastBuybackBlock = block.number;

        if (buyAmount != 0) {
            (uint256 minOut, uint160 sqrtPriceLimitX96, uint160 currentSqrtPriceX96, uint160 twapSqrtPriceX96) =
                quoteBuyback(buyAmount);
            amountOut = IFWAProtocolBuyAdapter(marketAdapter).buyExactInput{value: buyAmount}(minOut, sqrtPriceLimitX96);
            emit BuybackBoundsUsed(currentSqrtPriceX96, twapSqrtPriceX96, sqrtPriceLimitX96, minOut);
        }

        if (amountOut != 0) {
            address destination = rewardsPool;
            if (destination == address(0)) {
                _burn(address(this), amountOut);
            } else {
                uint256 toDep = amountOut * routeDepositorBps / TOTAL_BIPS;
                uint256 toPurchaser = amountOut * routePurchaserBps / TOTAL_BIPS;
                uint256 toBurn = amountOut - toDep - toPurchaser;

                if (toBurn != 0) _burn(address(this), toBurn);
                if (toDep + toPurchaser != 0) {
                    _transfer(address(this), destination, toDep + toPurchaser);
                    IFWABuybackRouter(destination).onTokenReceived(toDep, toPurchaser);
                }
                emit BuybackRouted(toDep, toPurchaser, toBurn);
            }
        }

        if (incentive != 0) SafeTransferLib.forceSafeTransferETH(msg.sender, incentive);
        emit Bought(msg.sender, buyAmount, amountOut, incentive);
    }

    function _tryTwapSqrtPriceX96() private view returns (bool ready, uint160 twapSqrtPriceX96) {
        address marketPool = pool;
        if (marketPool == address(0)) return (false, 0);
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = BUYBACK_TWAP_SECONDS;
        secondsAgos[1] = 0;
        try IHyperSwapV3Pool(marketPool).observe(secondsAgos) returns (
            int56[] memory tickCumulatives, uint160[] memory
        ) {
            if (tickCumulatives.length != 2) return (false, 0);
            int256 delta = int256(tickCumulatives[1]) - int256(tickCumulatives[0]);
            int256 window = int256(uint256(BUYBACK_TWAP_SECONDS));
            int256 rawMeanTick = delta / window;
            if (delta < 0 && delta % window != 0) rawMeanTick--;
            if (rawMeanTick < V3_MIN_TICK || rawMeanTick > V3_MAX_TICK) return (false, 0);
            // The explicit V3 tick-domain check above makes this narrowing conversion exact.
            // forge-lint: disable-next-line(unsafe-typecast)
            int24 meanTick = int24(rawMeanTick);
            return (true, TickMath.getSqrtPriceAtTick(meanTick));
        } catch {
            return (false, 0);
        }
    }

    function _relativePriceLimit(uint160 currentSqrtPriceX96) private view returns (uint160) {
        bool hwaIsToken0 = address(this) < WHYPE;
        uint256 rawLimit = hwaIsToken0
            ? uint256(currentSqrtPriceX96) * TOTAL_BIPS / BUYBACK_SQRT_LIMIT_BPS
            : uint256(currentSqrtPriceX96) * BUYBACK_SQRT_LIMIT_BPS / TOTAL_BIPS;
        if (rawLimit <= V3_MIN_SQRT_RATIO) rawLimit = uint256(V3_MIN_SQRT_RATIO) + 1;
        if (rawLimit >= V3_MAX_SQRT_RATIO) rawLimit = uint256(V3_MAX_SQRT_RATIO) - 1;
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint160(rawLimit);
    }

    function _quoteAtSqrtPrice(uint256 hypeIn, uint160 sqrtPriceX96) private view returns (uint256 hwaOut) {
        if (address(this) < WHYPE) {
            uint256 intermediate = FixedPointMathLib.fullMulDiv(hypeIn, Q96, sqrtPriceX96);
            hwaOut = FixedPointMathLib.fullMulDiv(intermediate, Q96, sqrtPriceX96);
        } else {
            uint256 intermediate = FixedPointMathLib.fullMulDiv(hypeIn, sqrtPriceX96, Q96);
            hwaOut = FixedPointMathLib.fullMulDiv(intermediate, sqrtPriceX96, Q96);
        }
    }

    function _afterTokenTransfer(address from, address to, uint256) internal view override {
        if (from == address(0) || to == address(0)) return;
        if (_launching && from == address(this)) return;
        if (isDistributor[from] || isDistributor[to]) return;

        address currentOwner = owner();
        if (from == currentOwner || to == currentOwner) return;

        address marketPool = pool;
        if (marketPool != address(0)) {
            if (from == marketPool || to == marketPool) _assertLivePoolConfiguration();
            if (to == marketPool) return;
            if (from == marketPool) {
                if (externalBuysEnabled || to == address(this) || isProtocolBuyer[to]) return;
                revert InvalidTransfer();
            }
        }

        revert InvalidTransfer();
    }

    function _assertLivePoolConfiguration() private view {
        IHyperSwapV3Pool poolContract = IHyperSwapV3Pool(pool);
        (address token0, address token1) = address(this) < WHYPE ? (address(this), WHYPE) : (WHYPE, address(this));
        (uint160 price,,,,,,) = poolContract.slot0();
        if (
            FACTORY.getPool(token0, token1, POOL_FEE) != pool || poolContract.token0() != token0
                || poolContract.token1() != token1 || poolContract.fee() != POOL_FEE
                || poolContract.tickSpacing() != POOL_TICK_SPACING || price == 0
        ) revert InvalidPoolConfiguration();
    }

    receive() external payable {}
}
