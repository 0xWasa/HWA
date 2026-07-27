// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {DrandRelayCoordinator} from "../src/hyperevm/DrandRelayCoordinator.sol";

interface VmFulfillDrandRelay {
    function envUint(string calldata name) external returns (uint256 value);
    function envBytes(string calldata name) external returns (bytes memory value);
    function envAddress(string calldata name) external returns (address value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice One-shot relayer entrypoint used by the local drand watcher.
contract FulfillDrandRelay {
    VmFulfillDrandRelay internal constant vm =
        VmFulfillDrandRelay(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    error WrongChain(uint256 actual);
    error InvalidInput();
    error UnauthorizedRelayer();
    error VerificationFailed();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 relayerKey = vm.envUint("FWA_DRAND_RELAYER_PRIVATE_KEY");
        uint256 requestId = vm.envUint("FWA_DRAND_REQUEST_ID");
        uint256 roundValue = vm.envUint("FWA_DRAND_ROUND");
        bytes memory signature = vm.envBytes("FWA_DRAND_SIGNATURE");
        DrandRelayCoordinator coordinator =
            DrandRelayCoordinator(payable(vm.envAddress("FWA_DRAND_COORDINATOR_ADDRESS")));
        if (requestId == 0 || roundValue == 0 || roundValue > type(uint64).max || signature.length != 64) {
            revert InvalidInput();
        }
        if (!coordinator.isRelayer(vm.addr(relayerKey))) revert UnauthorizedRelayer();

        vm.startBroadcast(relayerKey);
        coordinator.fulfillRandomness(requestId, uint64(roundValue), signature);
        vm.stopBroadcast();

        (, DrandRelayCoordinator.RequestStatus status) = coordinator.requestState(requestId);
        if (status != DrandRelayCoordinator.RequestStatus.Fulfilled) revert VerificationFailed();
    }
}
