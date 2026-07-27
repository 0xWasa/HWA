// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";

import {IHyperSwapV3PositionManager} from "./interfaces/IHyperSwapV3.sol";

/// @title HWAProjectXLiquidityLocker
/// @notice Irrevocably holds the canonical HWA/Project X LP NFT.
/// @dev Principal can never be withdrawn or decreased. Anyone may collect accrued fees to the configured recipient.
contract HWAProjectXLiquidityLocker is Ownable, ReentrancyGuard {
    IHyperSwapV3PositionManager public immutable POSITION_MANAGER;
    address public immutable CONTROLLER;

    address public feeRecipient;
    uint256 public tokenId;
    bool public bound;

    event PositionBound(uint256 indexed tokenId);
    event FeesCollected(address indexed caller, address indexed recipient, uint256 amount0, uint256 amount1);
    event FeeRecipientSet(address indexed recipient);

    error InvalidAddress();
    error InvalidContract();
    error OnlyController();
    error AlreadyBound();
    error NotBound();
    error NotPositionOwner();
    error UnsupportedNFT();

    constructor(address positionManager_, address controller_, address feeRecipient_, address owner_) {
        if (
            positionManager_ == address(0) || controller_ == address(0) || feeRecipient_ == address(0)
                || owner_ == address(0) || feeRecipient_ == address(this)
        ) revert InvalidAddress();
        if (positionManager_.code.length == 0 || controller_.code.length == 0) revert InvalidContract();

        POSITION_MANAGER = IHyperSwapV3PositionManager(positionManager_);
        CONTROLLER = controller_;
        feeRecipient = feeRecipient_;
        _initializeOwner(owner_);
    }

    function bind(uint256 tokenId_) external {
        if (msg.sender != CONTROLLER) revert OnlyController();
        if (bound) revert AlreadyBound();
        if (POSITION_MANAGER.ownerOf(tokenId_) != address(this)) revert NotPositionOwner();
        tokenId = tokenId_;
        bound = true;
        emit PositionBound(tokenId_);
    }

    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0) || recipient == address(this)) revert InvalidAddress();
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function collectFees() external nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (!bound) revert NotBound();
        address recipient = feeRecipient;
        (amount0, amount1) = POSITION_MANAGER.collect(
            IHyperSwapV3PositionManager.CollectParams({
                tokenId: tokenId, recipient: recipient, amount0Max: type(uint128).max, amount1Max: type(uint128).max
            })
        );
        emit FeesCollected(msg.sender, recipient, amount0, amount1);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(POSITION_MANAGER)) revert UnsupportedNFT();
        return this.onERC721Received.selector;
    }
}
