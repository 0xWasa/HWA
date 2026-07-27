// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DrandBN254Coordinator} from "../src/hyperevm/DrandBN254Coordinator.sol";

interface VmFulfillDrandBN254 {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBytes(string calldata name) external returns (bytes memory value);
    function envBool(string calldata name) external returns (bool value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Permissionless operational helper. Integrity comes from the on-chain BN254 proof, not this key.
contract FulfillDrandBN254 {
    VmFulfillDrandBN254 internal constant vm =
        VmFulfillDrandBN254(address(uint160(uint256(keccak256("hevm cheat code")))));

    error WrongChain(uint256 actual);
    error SubmissionNotConfirmed();
    error InvalidTarget();

    function run() external {
        if (block.chainid != 998 && block.chainid != 999) revert WrongChain(block.chainid);
        if (!vm.envBool("DRAND_PROOF_SUBMISSION_CONFIRMED")) revert SubmissionNotConfirmed();
        address coordinatorAddress = vm.envAddress("FWA_DRAND_BN254_COORDINATOR_ADDRESS");
        if (coordinatorAddress == address(0) || coordinatorAddress.code.length == 0) revert InvalidTarget();

        uint256 privateKey = vm.envUint("FWA_DRAND_SUBMITTER_PRIVATE_KEY");
        uint256 requestId = vm.envUint("FWA_DRAND_REQUEST_ID");
        uint256 round = vm.envUint("FWA_DRAND_ROUND");
        if (requestId == 0 || round == 0 || round > type(uint64).max) revert InvalidTarget();
        bytes memory signature = vm.envBytes("FWA_DRAND_SIGNATURE");

        vm.startBroadcast(privateKey);
        DrandBN254Coordinator(payable(coordinatorAddress)).fulfillRandomness(requestId, uint64(round), signature);
        vm.stopBroadcast();
    }
}
