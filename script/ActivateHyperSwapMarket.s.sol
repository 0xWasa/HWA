// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";

interface VmHyperSwapActivate {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Opens external pool buys only after the full core/PoP/HyperSwap E2E matrix passes.
contract ActivateHyperSwapMarket {
    VmHyperSwapActivate internal constant vm =
        VmHyperSwapActivate(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;

    error WrongChain(uint256 actual);
    error E2ENotConfirmed();
    error InvalidWiring();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("HYPERSWAP_E2E_CONFIRMED")) revert E2ENotConfirmed();

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWAHyperSwapAdapter adapter = FWAHyperSwapAdapter(payable(vm.envAddress("FWA_HYPERSWAP_ADAPTER_ADDRESS")));

        if (
            token.adapter() != address(adapter) || token.rewardsPool() != address(rewards)
                || adapter.rewardsBuyer() != address(rewards) || rewards.fwa() != address(fwa)
                || address(fwa.rewards()) != address(rewards) || fwa.token() != address(token)
        ) revert InvalidWiring();

        vm.startBroadcast(ownerKey);
        token.setExternalBuysEnabled(true);
        vm.stopBroadcast();
    }
}
