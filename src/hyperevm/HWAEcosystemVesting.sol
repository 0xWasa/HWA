// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";

/// @title HWA ecosystem vesting
/// @notice Immutable 24-month vesting with a 3-month cliff and no acceleration or admin path.
contract HWAEcosystemVesting {
    uint256 public constant CLIFF = 90 days;
    uint256 public constant DURATION = 730 days;

    address public immutable TOKEN;
    address public immutable BENEFICIARY;
    uint64 public immutable START;
    uint256 public immutable ALLOCATION;
    uint256 public released;

    event Released(address indexed beneficiary, uint256 amount);

    error InvalidConfig();
    error NothingToRelease();

    constructor(address token, address beneficiary, uint64 start, uint256 allocation) {
        if (token == address(0) || token.code.length == 0 || beneficiary == address(0) || start == 0 || allocation == 0) {
            revert InvalidConfig();
        }
        TOKEN = token;
        BENEFICIARY = beneficiary;
        START = start;
        ALLOCATION = allocation;
    }

    function vestedAmount(uint256 timestamp) public view returns (uint256) {
        uint256 start = START;
        if (timestamp < start + CLIFF) return 0;
        if (timestamp >= start + DURATION) return ALLOCATION;
        return ALLOCATION * (timestamp - start) / DURATION;
    }

    function releasable() public view returns (uint256) {
        uint256 vested = vestedAmount(block.timestamp);
        return vested > released ? vested - released : 0;
    }

    function release() external returns (uint256 amount) {
        amount = releasable();
        if (amount == 0) revert NothingToRelease();
        released += amount;
        SafeTransferLib.safeTransfer(TOKEN, BENEFICIARY, amount);
        emit Released(BENEFICIARY, amount);
    }
}