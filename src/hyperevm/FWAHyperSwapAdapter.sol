// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

import {
    IERC20Balance,
    IHyperSwapV3Factory,
    IHyperSwapV3Pool,
    IHyperSwapV3Router,
    IWrappedNative
} from "./interfaces/IHyperSwapV3.sol";

/// @title FWAHyperSwapAdapter
/// @notice Project X-compatible exact-input HYPE -> HWA adapter for protocol-controlled buys.
/// @dev It deliberately does not expose a public swap router. The caller is also the token recipient,
///      which keeps the pre-launch FWAToken pool guard enforceable and avoids arbitrary approvals.
contract FWAHyperSwapAdapter is Ownable, ReentrancyGuard {
    IHyperSwapV3Factory public immutable FACTORY;
    IHyperSwapV3Router public immutable ROUTER;
    IERC20Balance public immutable TOKEN;
    address public immutable WHYPE;
    address public immutable POOL;
    uint24 public immutable POOL_FEE;
    int24 public immutable TICK_SPACING;

    /// @notice The token contract is always allowed to call for its permissionless buyback path.
    address public immutable TOKEN_BUYER;
    /// @notice Bound once after rewards deployment; no rotation keeps stale modules from buying.
    address public rewardsBuyer;

    event RewardsBuyerSet(address indexed rewardsBuyer);
    event ProtocolBuy(
        address indexed caller,
        address indexed recipient,
        uint256 hypeIn,
        uint256 tokenOut,
        uint256 minOut,
        uint160 sqrtPriceLimitX96
    );
    event ForcedHypeRecovered(address indexed to, uint256 amount);

    error ZeroAddress();
    error InvalidContract();
    error InvalidRouter();
    error InvalidPool();
    error InvalidFee();
    error RewardsBuyerAlreadySet();
    error OnlyProtocolBuyer();
    error NoHype();
    error NoTokenOut();
    error SlippageBuy();
    error PartialFill();
    error OutputMismatch();
    error DirectHypeRejected();

    constructor(address factory_, address router_, address whype_, address token_, uint24 poolFee_, address owner_) {
        if (
            factory_ == address(0) || router_ == address(0) || whype_ == address(0) || token_ == address(0)
                || owner_ == address(0)
        ) revert ZeroAddress();
        if (factory_.code.length == 0 || router_.code.length == 0 || whype_.code.length == 0 || token_.code.length == 0)
        {
            revert InvalidContract();
        }

        IHyperSwapV3Factory factoryContract = IHyperSwapV3Factory(factory_);
        IHyperSwapV3Router routerContract = IHyperSwapV3Router(router_);
        if (routerContract.factory() != factory_ || routerContract.WETH9() != whype_) revert InvalidRouter();

        int24 tickSpacing = factoryContract.feeAmountTickSpacing(poolFee_);
        if (tickSpacing <= 0) revert InvalidFee();

        address pool = factoryContract.getPool(whype_, token_, poolFee_);
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool();

        IHyperSwapV3Pool poolContract = IHyperSwapV3Pool(pool);
        address token0 = poolContract.token0();
        address token1 = poolContract.token1();
        if (!((token0 == whype_ && token1 == token_) || (token0 == token_ && token1 == whype_))) {
            revert InvalidPool();
        }
        if (poolContract.fee() != poolFee_ || poolContract.tickSpacing() != tickSpacing) revert InvalidPool();

        FACTORY = factoryContract;
        ROUTER = routerContract;
        TOKEN = IERC20Balance(token_);
        WHYPE = whype_;
        POOL = pool;
        POOL_FEE = poolFee_;
        TICK_SPACING = tickSpacing;
        TOKEN_BUYER = token_;
        _initializeOwner(owner_);
    }

    function setRewardsBuyer(address rewardsBuyer_) external onlyOwner {
        if (rewardsBuyer != address(0)) revert RewardsBuyerAlreadySet();
        if (rewardsBuyer_ == address(0) || rewardsBuyer_.code.length == 0) revert InvalidContract();
        rewardsBuyer = rewardsBuyer_;
        emit RewardsBuyerSet(rewardsBuyer_);
    }

    /// @notice Spend the complete native HYPE input for HWA and deliver HWA to the caller.
    /// @dev Native HYPE is wrapped locally. A residual wHYPE balance delta means V3 did not consume
    ///      the entire exact input and turns the whole operation into a revert. This avoids depending
    ///      on the router-global `refundETH()` balance, which can be polluted by forced native funds.
    function buyExactInput(uint256 minOut, uint160 sqrtPriceLimitX96)
        external
        payable
        nonReentrant
        returns (uint256 tokenOut)
    {
        if (msg.sender != TOKEN_BUYER && msg.sender != rewardsBuyer) revert OnlyProtocolBuyer();
        if (msg.value == 0) revert NoHype();

        uint256 hypeBalanceBefore = address(this).balance - msg.value;
        uint256 whypeBalanceBefore = IWrappedNative(WHYPE).balanceOf(address(this));
        uint256 tokenBalanceBefore = TOKEN.balanceOf(msg.sender);

        IWrappedNative(WHYPE).deposit{value: msg.value}();
        SafeTransferLib.safeApproveWithRetry(WHYPE, address(ROUTER), msg.value);
        tokenOut = ROUTER.exactInputSingle(
            IHyperSwapV3Router.ExactInputSingleParams({
                tokenIn: WHYPE,
                tokenOut: address(TOKEN),
                fee: POOL_FEE,
                recipient: msg.sender,
                deadline: block.timestamp,
                amountIn: msg.value,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: sqrtPriceLimitX96
            })
        );
        SafeTransferLib.safeApprove(WHYPE, address(ROUTER), 0);

        if (
            address(this).balance != hypeBalanceBefore
                || IWrappedNative(WHYPE).balanceOf(address(this)) != whypeBalanceBefore
        ) revert PartialFill();
        if (tokenOut == 0) revert NoTokenOut();
        if (tokenOut < minOut) revert SlippageBuy();

        uint256 tokenBalanceAfter = TOKEN.balanceOf(msg.sender);
        if (tokenBalanceAfter < tokenBalanceBefore || tokenBalanceAfter - tokenBalanceBefore != tokenOut) {
            revert OutputMismatch();
        }

        emit ProtocolBuy(msg.sender, msg.sender, msg.value, tokenOut, minOut, sqrtPriceLimitX96);
    }

    /// @notice Recover only HYPE forcibly sent outside `buyExactInput`; the adapter has no liabilities.
    function recoverForcedHype(address to) external onlyOwner nonReentrant returns (uint256 amount) {
        if (to == address(0) || to == address(this)) revert ZeroAddress();
        amount = address(this).balance;
        if (amount != 0) SafeTransferLib.forceSafeTransferETH(to, amount);
        emit ForcedHypeRecovered(to, amount);
    }

    receive() external payable {
        revert DirectHypeRejected();
    }
}
