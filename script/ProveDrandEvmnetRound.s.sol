// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DrandEvmnetRegistry} from "../src/hyperevm/DrandEvmnetRegistry.sol";

interface VmProveDrandRound {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBytes(string calldata name) external returns (bytes memory value);
    function envBool(string calldata name) external returns (bool value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Permissionless heartbeat helper used to satisfy the pre-launch recent-proof latch.
contract ProveDrandEvmnetRound {
    VmProveDrandRound internal constant vm = VmProveDrandRound(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 actual);
    error SubmissionNotConfirmed();
    error InvalidTarget();

    function run() external {
        if (block.chainid != 998 && block.chainid != 999) revert WrongChain(block.chainid);
        if (!vm.envBool("DRAND_PROOF_SUBMISSION_CONFIRMED")) revert SubmissionNotConfirmed();
        address registryAddress = vm.envAddress("FWA_DRAND_REGISTRY_ADDRESS");
        if (registryAddress == address(0) || registryAddress.code.length == 0) revert InvalidTarget();

        uint256 privateKey = vm.envUint("FWA_DRAND_SUBMITTER_PRIVATE_KEY");
        uint256 round = vm.envUint("FWA_DRAND_ROUND");
        if (round == 0 || round > type(uint64).max) revert InvalidTarget();
        bytes memory signature = vm.envBytes("FWA_DRAND_SIGNATURE");

        vm.startBroadcast(privateKey);
        DrandEvmnetRegistry(registryAddress).proveRound(signature, uint64(round));
        vm.stopBroadcast();
    }
}
