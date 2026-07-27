// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

import {
    INestAlgebraFactory,
    INestAlgebraPool,
    INestERC20Balance,
    INestSwapRouter,
    INestWrappedNative
} from "./interfaces/INestAlgebra.sol";

interface IFWANestProtocolBuyContext {
    function beginProtocolBuy(address recipient) external;
    function endProtocolBuy() external;
}

/// @title FWANestSwapAdapter
/// @notice Exact-input HYPE -> HWA adapter for the protocol-controlled Nest buying paths.
contract FWANestSwapAdapter is Ownable, ReentrancyGuard {
    INestAlgebraFactory public immutable FACTORY;
    INestSwapRouter public immutable ROUTER;
    INestERC20Balance public immutable TOKEN;
    address public immutable WHYPE;
    address public immutable POOL;
    uint16 public immutable POOL_FEE;
    int24 public immutable TICK_SPACING;

    address public immutable TOKEN_BUYER;
    address public rewardsBuyer;

    event RewardsBuyerSet(address indexed rewardsBuyer);
    event ProtocolBuy(
        address indexed caller,
        address indexed recipient,
        uint256 hypeIn,
        uint256 tokenOut,
        uint256 minOut,
        uint160 limitSqrtPrice
    );
    event ForcedHypeRecovered(address indexed to, uint256 amount);

    error ZeroAddress();
    error InvalidContract();
    error InvalidRouter();
    error InvalidPool();
    error RewardsBuyerAlreadySet();
    error OnlyProtocolBuyer();
    error NoHype();
    error NoTokenOut();
    error SlippageBuy();
    error PartialFill();
    error OutputMismatch();
    error DirectHypeRejected();

    constructor(address factory_, address router_, address whype_, address token_, address owner_) {
        if (
            factory_ == address(0) || router_ == address(0) || whype_ == address(0) || token_ == address(0)
                || owner_ == address(0)
        ) revert ZeroAddress();
        if (factory_.code.length == 0 || router_.code.length == 0 || whype_.code.length == 0 || token_.code.length == 0)
        {
            revert InvalidContract();
        }

        INestAlgebraFactory factoryContract = INestAlgebraFactory(factory_);
        INestSwapRouter routerContract = INestSwapRouter(router_);
        if (routerContract.factory() != factory_ || routerContract.WNativeToken() != whype_) revert InvalidRouter();

        address pool = factoryContract.poolByPair(whype_, token_);
        if (pool == address(0) || pool.code.length == 0) revert InvalidPool();
        INestAlgebraPool poolContract = INestAlgebraPool(pool);
        address token0 = poolContract.token0();
        address token1 = poolContract.token1();
        if (
            poolContract.factory() != factory_
                || !((token0 == whype_ && token1 == token_) || (token0 == token_ && token1 == whype_))
        ) revert InvalidPool();

        FACTORY = factoryContract;
        ROUTER = routerContract;
        TOKEN = INestERC20Balance(token_);
        WHYPE = whype_;
        POOL = pool;
        POOL_FEE = poolContract.fee();
        TICK_SPACING = poolContract.tickSpacing();
        TOKEN_BUYER = token_;
        _initializeOwner(owner_);
    }

    function setRewardsBuyer(address rewardsBuyer_) external onlyOwner {
        if (rewardsBuyer != address(0)) revert RewardsBuyerAlreadySet();
        if (rewardsBuyer_ == address(0) || rewardsBuyer_.code.length == 0) revert InvalidContract();
        rewardsBuyer = rewardsBuyer_;
        emit RewardsBuyerSet(rewardsBuyer_);
    }

    function buyExactInput(uint256 minOut, uint160 limitSqrtPrice)
        external
        payable
        nonReentrant
        returns (uint256 tokenOut)
    {
        if (msg.sender != TOKEN_BUYER && msg.sender != rewardsBuyer) revert OnlyProtocolBuyer();
        if (msg.value == 0) revert NoHype();

        uint256 hypeBalanceBefore = address(this).balance - msg.value;
        uint256 whypeBalanceBefore = INestWrappedNative(WHYPE).balanceOf(address(this));
        uint256 tokenBalanceBefore = TOKEN.balanceOf(msg.sender);

        INestWrappedNative(WHYPE).deposit{value: msg.value}();
        SafeTransferLib.safeApproveWithRetry(WHYPE, address(ROUTER), msg.value);
        IFWANestProtocolBuyContext(address(TOKEN)).beginProtocolBuy(msg.sender);
        tokenOut = ROUTER.exactInputSingle(
            INestSwapRouter.ExactInputSingleParams({
                tokenIn: WHYPE,
                tokenOut: address(TOKEN),
                recipient: msg.sender,
                deadline: block.timestamp,
                amountIn: msg.value,
                amountOutMinimum: minOut,
                limitSqrtPrice: limitSqrtPrice
            })
        );
        IFWANestProtocolBuyContext(address(TOKEN)).endProtocolBuy();
        SafeTransferLib.safeApprove(WHYPE, address(ROUTER), 0);

        if (
            address(this).balance != hypeBalanceBefore
                || INestWrappedNative(WHYPE).balanceOf(address(this)) != whypeBalanceBefore
        ) revert PartialFill();
        if (tokenOut == 0) revert NoTokenOut();
        if (tokenOut < minOut) revert SlippageBuy();

        uint256 tokenBalanceAfter = TOKEN.balanceOf(msg.sender);
        if (tokenBalanceAfter < tokenBalanceBefore || tokenBalanceAfter - tokenBalanceBefore != tokenOut) {
            revert OutputMismatch();
        }

        emit ProtocolBuy(msg.sender, msg.sender, msg.value, tokenOut, minOut, limitSqrtPrice);
    }

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
