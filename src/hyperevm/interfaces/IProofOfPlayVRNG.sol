// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Minimal Proof of Play vRNG request surface documented for HyperEVM.
interface IProofOfPlayVRNG {
    function requestRandomNumberWithTraceId(uint256 traceId) external returns (uint256 requestId);
}

/// @notice Callback that Proof of Play invokes on the requesting contract.
interface IProofOfPlayVRNGCallback {
    function randomNumberCallback(uint256 requestId, uint256 randomNumber) external;
}

