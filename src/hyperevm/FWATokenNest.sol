// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "solady/src/tokens/ERC20.sol";
import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {FWANestPlugin} from "./FWANestPlugin.sol";
import {FWANestLiquidityLocker} from "./FWANestLiquidityLocker.sol";
import {INestAlgebraFactory, INestAlgebraPool, INestPositionManager} from "./interfaces/INestAlgebra.sol";

interface IFWANestProtocolBuyAdapter {
    function TOKEN() external view returns (address);
    function WHYPE() external view returns (address);
    function POOL() external view returns (address);
    function TOKEN_BUYER() external view returns (address);
    function buyExactInput(uint256 minOut, uint160 limitSqrtPrice) external payable returns (uint256 tokenOut);
}

interface IFWANestBuybackRouter {
    function onTokenReceived(uint256 depositorAmt, uint256 purchaserAmt) external;
}

/// @title FWATokenNest
/// @notice Fixed-supply Hyper World Assets (HWA) incentive token prepared for a Nest Algebra Integral pool.
contract FWATokenNest is ERC20, Ownable, ReentrancyGuard {
    uint16 public constant POOL_FEE = 10_000;
    int24 public constant POOL_TICK_SPACING = 60;
    uint16 public constant REQUIRED_COMMUNITY_FEE = 0;
    uint8 public constant REQUIRED_PLUGIN_CONFIG = 7;

    uint256 public constant BUYBACK_INCREMENT = 1 ether;
    uint256 public constant BUYBACK_DELAY_BLOCKS = 1;
    uint256 public constant EMERGENCY_RESCUE_DELAY = 7 days;
    uint256 public constant CALLER_REWARD_BPS = 50;
    uint256 private constant TOTAL_BIPS = 10_000;
    uint256 private constant DEFAULT_BUYBACK_SQRT_LIMIT_BPS = 9_535;

    uint160 private constant MIN_SQRT_RATIO = 4_295_128_739;
    uint160 private constant MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

    INestAlgebraFactory public immutable FACTORY;
    INestPositionManager public immutable POSITION_MANAGER;
    address public immutable WHYPE;

    string private _tokenName;
    string private _tokenSymbol;

    address public pool;
    address public plugin;
    address public liquidityLocker;
    address public adapter;
    address public rewardsPool;
    uint256 public lpTokenId;
    uint160 public initialSqrtPriceX96;
    bool public marketInitialized;
    bool public launched;
    bool public externalBuysEnabled;
    bytes32 private constant LAUNCHING_SLOT = keccak256("HWA.NEST.LAUNCHING.V1");
    bytes32 private constant PROTOCOL_BUY_ACTIVE_SLOT = keccak256("HWA.NEST.PROTOCOL_BUY.ACTIVE.V1");
    bytes32 private constant PROTOCOL_BUY_RECIPIENT_SLOT = keccak256("HWA.NEST.PROTOCOL_BUY.RECIPIENT.V1");

    mapping(address account => bool allowed) public isDistributor;
    mapping(address account => bool allowed) public isProtocolBuyer;

    uint256 public lastBuybackBlock;
    uint160 public buybackSqrtPriceLimitX96;
    uint256 public buybackMinOutPerHypeX96;
    uint256 public routeDepositorBps = 4_000;
    uint256 public routePurchaserBps = 4_000;
    uint256 public routeBurnBps = 2_000;
    uint256 public emergencyRescueAvailableAt;
    bytes32 public emergencyRescueFingerprint;

    event DistributorSet(address indexed account, bool allowed);
    event ProtocolBuyerSet(address indexed account, bool allowed);
    event ExternalBuysEnabledSet(bool enabled);
    event MarketInfrastructureSet(address indexed pool, address indexed plugin, address indexed liquidityLocker);
    event MarketInitialized(address indexed pool, uint160 sqrtPriceX96);
    event MarketAdapterSet(address indexed adapter, address indexed pool);
    event RewardsPoolSet(address indexed rewardsPool);
    event RouteSplitSet(uint256 depBps, uint256 purchaserBps, uint256 burnBps);
    event BuybackPriceLimitSet(uint160 sqrtPriceLimitX96);
    event BuybackMinOutPerHypeSet(uint256 minOutPerHypeX96);
    event Bought(address indexed caller, uint256 hypeSpent, uint256 amountBought, uint256 callerReward);
    event BuybackRouted(uint256 toDepositors, uint256 toPurchasers, uint256 burned);
    event EmergencyHypeRescueScheduled(uint256 availableAt, bytes32 indexed failureFingerprint);
    event EmergencyHypeRescueCancelled();
    event EmergencyHypeRescued(address indexed owner, uint256 amount, bytes32 indexed failureFingerprint);
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
    error MarketAlreadyInitialized();
    error NoLpSupply();
    error InvalidRange();
    error InvalidSplit();
    error MarketNotLaunched();
    error MarketAlreadyConfigured();
    error MarketNotConfigured();
    error AdapterAlreadySet();
    error RewardsPoolAlreadySet();
    error InvalidAdapter();
    error InvalidPoolConfiguration();
    error OnlyAdapter();
    error ProtocolBuyNotActive();
    error PoolConfigurationHealthy();
    error RescueNotScheduled();
    error RescueDelayNotElapsed();
    error RescueConditionChanged();

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

        INestPositionManager positionManager = INestPositionManager(positionManager_);
        if (positionManager.factory() != factory_ || positionManager.WNativeToken() != whype_) {
            revert InvalidContract();
        }

        _tokenName = name_;
        _tokenSymbol = symbol_;
        FACTORY = INestAlgebraFactory(factory_);
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

    function launching() external view returns (bool) {
        return _transientLoad(LAUNCHING_SLOT) != 0;
    }

    function protocolBuyActive(address recipient) external view returns (bool) {
        return _transientLoad(PROTOCOL_BUY_ACTIVE_SLOT) != 0
            && address(uint160(_transientLoad(PROTOCOL_BUY_RECIPIENT_SLOT))) == recipient;
    }

    /// @notice Adapter-only transient handshake consumed by the pool plugin in this transaction.
    function beginProtocolBuy(address recipient) external {
        if (msg.sender != adapter) revert OnlyAdapter();
        if (recipient != address(this) && !isProtocolBuyer[recipient]) revert InvalidAddress();
        _transientStore(PROTOCOL_BUY_RECIPIENT_SLOT, uint256(uint160(recipient)));
        _transientStore(PROTOCOL_BUY_ACTIVE_SLOT, 1);
    }

    function endProtocolBuy() external {
        if (msg.sender != adapter) revert OnlyAdapter();
        if (_transientLoad(PROTOCOL_BUY_ACTIVE_SLOT) == 0) revert ProtocolBuyNotActive();
        _transientStore(PROTOCOL_BUY_ACTIVE_SLOT, 0);
        _transientStore(PROTOCOL_BUY_RECIPIENT_SLOT, 0);
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
        // Closing is an unconditional kill switch. Opening inherits production wiring and live-pool
        // invariants so bare Safe calldata cannot bypass the audited activation script.
        if (enabled) {
            if (adapter == address(0) || rewardsPool == address(0)) revert MarketNotConfigured();
            _assertLivePoolConfiguration(INestAlgebraPool(pool));
        }
        externalBuysEnabled = enabled;
        emit ExternalBuysEnabledSet(enabled);
    }

    /// @notice Bind the pool created by Nest, the HWA guard plugin installed by Nest and the immutable LP locker.
    function setMarketInfrastructure(address plugin_, address liquidityLocker_) external onlyOwner {
        if (pool != address(0) || plugin != address(0) || liquidityLocker != address(0)) {
            revert MarketAlreadyConfigured();
        }
        if (plugin_ == address(0) || liquidityLocker_ == address(0)) revert InvalidAddress();

        address marketPool = FACTORY.poolByPair(WHYPE, address(this));
        if (marketPool == address(0) || marketPool.code.length == 0) revert InvalidContract();
        INestAlgebraPool poolContract = INestAlgebraPool(marketPool);
        if (
            poolContract.factory() != address(FACTORY) || FWANestPlugin(plugin_).POOL() != poolContract
                || address(FWANestPlugin(plugin_).TOKEN()) != address(this) || FWANestPlugin(plugin_).WHYPE() != WHYPE
        ) revert InvalidPoolConfiguration();

        FWANestLiquidityLocker locker = FWANestLiquidityLocker(liquidityLocker_);
        if (
            address(locker.POSITION_MANAGER()) != address(POSITION_MANAGER) || locker.CONTROLLER() != address(this)
                || locker.bound()
        ) revert InvalidPoolConfiguration();

        pool = marketPool;
        plugin = plugin_;
        liquidityLocker = liquidityLocker_;
        emit MarketInfrastructureSet(marketPool, plugin_, liquidityLocker_);
    }

    function setAdapter(address adapter_) external onlyOwner {
        if (!launched) revert MarketNotLaunched();
        if (adapter != address(0)) revert AdapterAlreadySet();
        if (adapter_ == address(0) || adapter_.code.length == 0) revert InvalidAdapter();

        IFWANestProtocolBuyAdapter candidate = IFWANestProtocolBuyAdapter(adapter_);
        if (
            candidate.TOKEN() != address(this) || candidate.TOKEN_BUYER() != address(this) || candidate.WHYPE() != WHYPE
                || candidate.POOL() != pool
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

    function setBuybackSqrtPriceLimitX96(uint160 sqrtPriceLimitX96) external onlyOwner {
        if (sqrtPriceLimitX96 <= MIN_SQRT_RATIO || sqrtPriceLimitX96 >= MAX_SQRT_RATIO) revert InvalidRange();
        buybackSqrtPriceLimitX96 = sqrtPriceLimitX96;
        emit BuybackPriceLimitSet(sqrtPriceLimitX96);
    }

    function setBuybackMinOutPerHypeX96(uint256 minOutPerHypeX96) external onlyOwner {
        if (minOutPerHypeX96 == 0) revert InvalidRange();
        buybackMinOutPerHypeX96 = minOutPerHypeX96;
        emit BuybackMinOutPerHypeSet(minOutPerHypeX96);
    }

    /// @notice Start a visible delay before HYPE can be recovered from a market that Nest configuration drift
    ///         has made unusable. Public trading must already be closed. The exact failure fingerprint is pinned,
    ///         preventing the rescue from being reused for a different configuration incident.
    function scheduleEmergencyHypeRescue() external onlyOwner {
        if (externalBuysEnabled) revert InvalidTransfer();
        INestAlgebraPool marketPool = INestAlgebraPool(pool);
        if (_isLivePoolConfiguration(marketPool)) revert PoolConfigurationHealthy();
        bytes32 fingerprint = _poolConfigurationFingerprint(marketPool);
        emergencyRescueAvailableAt = block.timestamp + EMERGENCY_RESCUE_DELAY;
        emergencyRescueFingerprint = fingerprint;
        emit EmergencyHypeRescueScheduled(emergencyRescueAvailableAt, fingerprint);
    }

    function cancelEmergencyHypeRescue() external onlyOwner {
        if (emergencyRescueAvailableAt == 0) revert RescueNotScheduled();
        emergencyRescueAvailableAt = 0;
        emergencyRescueFingerprint = bytes32(0);
        emit EmergencyHypeRescueCancelled();
    }

    /// @notice Permissionless execution to the owner Safe after the full delay. This path is unavailable while
    ///         the pool is healthy or public buys are open and cannot redirect funds to an arbitrary address.
    function executeEmergencyHypeRescue() external nonReentrant returns (uint256 amount) {
        uint256 availableAt = emergencyRescueAvailableAt;
        if (availableAt == 0) revert RescueNotScheduled();
        if (block.timestamp < availableAt) revert RescueDelayNotElapsed();
        if (externalBuysEnabled) revert InvalidTransfer();
        INestAlgebraPool marketPool = INestAlgebraPool(pool);
        if (_isLivePoolConfiguration(marketPool)) revert PoolConfigurationHealthy();
        bytes32 fingerprint = _poolConfigurationFingerprint(marketPool);
        if (fingerprint != emergencyRescueFingerprint) revert RescueConditionChanged();

        emergencyRescueAvailableAt = 0;
        emergencyRescueFingerprint = bytes32(0);
        amount = address(this).balance;
        if (amount == 0) revert NoHype();
        address recipient = owner();
        SafeTransferLib.forceSafeTransferETH(recipient, amount);
        emit EmergencyHypeRescued(recipient, amount, fingerprint);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Initialize the Nest pool while the plugin keeps swaps and liquidity additions closed.
    /// @dev Algebra reapplies factory defaults during initialize, so final pool parameters must be
    ///      configured by Nest after this call and before finalizeLaunch.
    function initializeMarket(uint160 sqrtPriceX96) external onlyOwner nonReentrant {
        if (launched) revert AlreadyLaunched();
        if (marketInitialized) revert MarketAlreadyInitialized();
        address marketPool = pool;
        address marketPlugin = plugin;
        if (marketPool == address(0) || marketPlugin == address(0) || liquidityLocker == address(0)) {
            revert MarketNotConfigured();
        }
        if (sqrtPriceX96 <= MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) revert InvalidRange();

        (address token0, address token1) = address(this) < WHYPE ? (address(this), WHYPE) : (WHYPE, address(this));
        INestAlgebraPool poolContract = INestAlgebraPool(marketPool);
        (uint160 currentPrice,,, uint8 pluginConfig,,) = poolContract.globalState();
        if (
            FACTORY.poolByPair(token0, token1) != marketPool || poolContract.token0() != token0
                || poolContract.token1() != token1 || poolContract.plugin() != marketPlugin
                || pluginConfig != REQUIRED_PLUGIN_CONFIG || currentPrice != 0
        ) revert InvalidPoolConfiguration();

        _transientStore(LAUNCHING_SLOT, 1);
        address initializedPool = POSITION_MANAGER.createAndInitializePoolIfNecessary(token0, token1, sqrtPriceX96);
        _transientStore(LAUNCHING_SLOT, 0);
        if (initializedPool != marketPool) revert InvalidPoolConfiguration();

        (currentPrice,,, pluginConfig,,) = poolContract.globalState();
        if (
            currentPrice != sqrtPriceX96 || poolContract.plugin() != marketPlugin
                || pluginConfig != REQUIRED_PLUGIN_CONFIG
        ) revert InvalidPoolConfiguration();

        initialSqrtPriceX96 = sqrtPriceX96;
        marketInitialized = true;
        emit MarketInitialized(marketPool, sqrtPriceX96);
    }

    /// @notice Seed and permanently lock the single-sided position after Nest's post-init configuration.
    function finalizeLaunch(int24 tickLower, int24 tickUpper)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokenId, uint128 liquidity, uint256 tokenSeeded)
    {
        if (launched) revert AlreadyLaunched();
        if (!marketInitialized) revert MarketNotLaunched();
        address marketPool = pool;
        address marketPlugin = plugin;
        address locker = liquidityLocker;
        if (marketPool == address(0) || marketPlugin == address(0) || locker == address(0)) {
            revert MarketNotConfigured();
        }
        uint256 tokenAmount = balanceOf(address(this));
        if (tokenAmount == 0) revert NoLpSupply();
        uint160 sqrtPriceX96 = initialSqrtPriceX96;
        if (tickLower >= tickUpper || tickLower % POOL_TICK_SPACING != 0 || tickUpper % POOL_TICK_SPACING != 0) {
            revert InvalidRange();
        }

        (address token0, address token1) = address(this) < WHYPE ? (address(this), WHYPE) : (WHYPE, address(this));
        bool hwaIsToken0 = token0 == address(this);
        if (hwaIsToken0) {
            if (sqrtPriceX96 > TickMath.getSqrtPriceAtTick(tickLower)) revert InvalidRange();
        } else if (sqrtPriceX96 < TickMath.getSqrtPriceAtTick(tickUpper)) {
            revert InvalidRange();
        }

        INestAlgebraPool poolContract = INestAlgebraPool(marketPool);
        (uint160 currentPrice,,, uint8 pluginConfig, uint16 communityFee,) = poolContract.globalState();
        if (
            FACTORY.poolByPair(token0, token1) != marketPool || poolContract.token0() != token0
                || poolContract.token1() != token1 || poolContract.plugin() != marketPlugin
                || pluginConfig != REQUIRED_PLUGIN_CONFIG || poolContract.fee() != POOL_FEE
                || poolContract.tickSpacing() != POOL_TICK_SPACING || communityFee != REQUIRED_COMMUNITY_FEE
                || currentPrice != sqrtPriceX96
        ) revert InvalidPoolConfiguration();

        _transientStore(LAUNCHING_SLOT, 1);
        _approve(address(this), address(POSITION_MANAGER), tokenAmount);
        uint256 amount0;
        uint256 amount1;
        (tokenId, liquidity, amount0, amount1) = POSITION_MANAGER.mint(
            INestPositionManager.MintParams({
                token0: token0,
                token1: token1,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: hwaIsToken0 ? tokenAmount : 0,
                amount1Desired: hwaIsToken0 ? 0 : tokenAmount,
                amount0Min: 0,
                amount1Min: 0,
                recipient: locker,
                deadline: block.timestamp
            })
        );
        _approve(address(this), address(POSITION_MANAGER), 0);
        _transientStore(LAUNCHING_SLOT, 0);

        tokenSeeded = hwaIsToken0 ? amount0 : amount1;
        if (tokenSeeded == 0 || liquidity == 0 || POSITION_MANAGER.ownerOf(tokenId) != locker) {
            revert InvalidPoolConfiguration();
        }
        FWANestLiquidityLocker(locker).bind(tokenId);
        lpTokenId = tokenId;
        launched = true;

        uint256 rawLimit = hwaIsToken0
            ? uint256(sqrtPriceX96) * TOTAL_BIPS / DEFAULT_BUYBACK_SQRT_LIMIT_BPS
            : uint256(sqrtPriceX96) * DEFAULT_BUYBACK_SQRT_LIMIT_BPS / TOTAL_BIPS;
        if (rawLimit <= MIN_SQRT_RATIO) rawLimit = uint256(MIN_SQRT_RATIO) + 1;
        if (rawLimit >= MAX_SQRT_RATIO) rawLimit = uint256(MAX_SQRT_RATIO) - 1;
        // forge-lint: disable-next-line(unsafe-typecast)
        buybackSqrtPriceLimitX96 = uint160(rawLimit);
        // forge-lint: disable-next-line(unsafe-typecast)
        emit BuybackPriceLimitSet(uint160(rawLimit));
        emit Launched(marketPool, tokenId, locker, sqrtPriceX96, tickLower, tickUpper, liquidity, tokenSeeded);
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
            uint256 minOutPerHype = buybackMinOutPerHypeX96;
            if (minOutPerHype == 0) revert InvalidRange();
            uint256 minOut = FixedPointMathLib.fullMulDiv(buyAmount, minOutPerHype, 1 << 96);
            amountOut = IFWANestProtocolBuyAdapter(marketAdapter).buyExactInput{value: buyAmount}(
                minOut, buybackSqrtPriceLimitX96
            );
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
                    IFWANestBuybackRouter(destination).onTokenReceived(toDep, toPurchaser);
                }
                emit BuybackRouted(toDep, toPurchaser, toBurn);
            }
        }

        if (incentive != 0) SafeTransferLib.forceSafeTransferETH(msg.sender, incentive);
        emit Bought(msg.sender, buyAmount, amountOut, incentive);
    }

    function _afterTokenTransfer(address from, address to, uint256) internal view override {
        if (from == address(0) || to == address(0)) return;
        if (_transientLoad(LAUNCHING_SLOT) != 0 && from == address(this) && to == pool) return;

        address marketPool = pool;
        if (marketPool != address(0) && (from == marketPool || to == marketPool)) {
            _assertLivePoolConfiguration(INestAlgebraPool(marketPool));
        }
        if (isDistributor[from] || isDistributor[to]) return;

        address currentOwner = owner();
        if (from == currentOwner || to == currentOwner) return;

        if (marketPool != address(0)) {
            if (to == marketPool) return;
            if (from == marketPool) {
                if (externalBuysEnabled || to == address(this) || isProtocolBuyer[to]) return;
                revert InvalidTransfer();
            }
        }

        revert InvalidTransfer();
    }

    function _assertLivePoolConfiguration(INestAlgebraPool poolContract) private view {
        if (!_isLivePoolConfiguration(poolContract)) revert InvalidPoolConfiguration();
    }

    function _isLivePoolConfiguration(INestAlgebraPool poolContract) private view returns (bool) {
        (,,, uint8 config, uint16 communityFee,) = poolContract.globalState();
        return poolContract.plugin() == plugin && config == REQUIRED_PLUGIN_CONFIG && poolContract.fee() == POOL_FEE
            && poolContract.tickSpacing() == POOL_TICK_SPACING && communityFee == REQUIRED_COMMUNITY_FEE;
    }

    function _poolConfigurationFingerprint(INestAlgebraPool poolContract) private view returns (bytes32) {
        (uint160 price, int24 tick, uint16 lastFee, uint8 config, uint16 communityFee, bool unlocked) =
            poolContract.globalState();
        return keccak256(
            abi.encode(
                poolContract.plugin(),
                config,
                poolContract.fee(),
                poolContract.tickSpacing(),
                communityFee,
                price,
                tick,
                lastFee,
                unlocked
            )
        );
    }

    receive() external payable {}

    function _transientLoad(bytes32 slot) private view returns (uint256 value) {
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function _transientStore(bytes32 slot, uint256 value) private {
        assembly ("memory-safe") {
            tstore(slot, value)
        }
    }
}
