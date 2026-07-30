// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAConfigKeys} from "fwa-reference/src/FWAConfigKeys.sol";

import {DrandBN254Coordinator} from "../src/hyperevm/DrandBN254Coordinator.sol";
import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmActivateHWAV2Cutover {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Final explicit v2 cutover: start the 300M / 15-day rewards clock and open public Project X buys.
contract ActivateHWAV2MainnetCutover {
    VmActivateHWAV2Cutover internal constant vm =
        VmActivateHWAV2Cutover(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant MAINNET = 999;
    uint256 internal constant TOTAL_REWARDS = 300_000_000 ether;

    error WrongChain(uint256 actual);
    error ConfirmationMissing();
    error InvalidWiring();

    function run() external {
        if (block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (!vm.envBool("HWA_V2_CUTOVER_CONFIRMED") || !vm.envBool("PROJECTX_PUBLIC_TRADING_CONFIRMED")) {
            revert ConfirmationMissing();
        }

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWAHyperSwapAdapter adapter = FWAHyperSwapAdapter(payable(vm.envAddress("FWA_PROJECTX_ADAPTER_ADDRESS")));
        DrandBN254Coordinator coordinator =
            DrandBN254Coordinator(payable(vm.envAddress("FWA_DRAND_BN254_COORDINATOR_ADDRESS")));

        MainnetOwnerPolicy.validateDeploymentOwner(fwa.owner(), owner, vm.envBool("MAINNET_EOA_OWNER_CONFIRMED"));
        if (
            token.owner() != owner || rewards.owner() != owner || adapter.owner() != owner
                || address(fwa.rewards()) != address(rewards) || rewards.fwa() != address(fwa)
                || rewards.token() != address(token) || address(rewards.swapAdapter()) != address(adapter)
                || token.adapter() != address(adapter) || token.rewardsPool() != address(rewards)
                || adapter.rewardsBuyer() != address(rewards) || fwa.token() != address(token)
                || !coordinator.launchReady() || coordinator.pendingRequestCount() != 0
                || fwa.activeListingCount() != 0 || fwa.unsettledAcquisitionCount() != 0
                || fwa.acquisitionsEnabled() || token.externalBuysEnabled() || rewards.emissionStart() != 0
                || token.balanceOf(address(rewards)) < TOTAL_REWARDS
        ) revert InvalidWiring();

        vm.startBroadcast(ownerKey);
        fwa.setBool(FWAConfigKeys.ACQUISITIONS_ENABLED, true);
        token.setExternalBuysEnabled(true);
        vm.stopBroadcast();

        if (!fwa.acquisitionsEnabled() || !token.externalBuysEnabled() || rewards.emissionStart() == 0) {
            revert InvalidWiring();
        }
    }
}