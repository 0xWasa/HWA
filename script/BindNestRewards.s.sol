// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWANestSwapAdapter} from "../src/hyperevm/FWANestSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";

interface VmNestRewardsBind {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Nest phase H: bind the prepared rewards module from the current FWA core owner.
contract BindNestRewards {
    VmNestRewardsBind internal constant vm = VmNestRewardsBind(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;

    event NestRewardsBound(address indexed fwa, address indexed rewards, address indexed owner);

    error BindingNotConfirmed();
    error MainnetNotConfirmed();
    error UnauthorizedOwner();
    error CoreNotReady();
    error InvalidWiring();
    error WrongChain(uint256 actual);

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("NEST_CORE_BINDING_CONFIRMED")) revert BindingNotConfirmed();
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID && !vm.envBool("NEST_MAINNET_DEPLOYMENT_CONFIRMED")) {
            revert MainnetNotConfirmed();
        }

        uint256 ownerKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenNest token = FWATokenNest(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWANestSwapAdapter adapter = FWANestSwapAdapter(payable(vm.envAddress("FWA_NEST_ADAPTER_ADDRESS")));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));

        if (fwa.owner() != owner) revert UnauthorizedOwner();
        if (
            address(fwa.rewards()) != address(0) || fwa.activeListingCount() != 0
                || fwa.unsettledAcquisitionCount() != 0
        ) {
            revert CoreNotReady();
        }
        if (
            rewards.fwa() != address(fwa) || rewards.token() != address(token)
                || address(rewards.swapAdapter()) != address(adapter) || token.rewardsPool() != address(rewards)
                || token.adapter() != address(adapter) || adapter.rewardsBuyer() != address(rewards)
                || address(splitter).code.length == 0 || fwa.payoutAddress() != address(splitter)
        ) revert InvalidWiring();

        vm.startBroadcast(ownerKey);
        fwa.setRewards(address(rewards));
        vm.stopBroadcast();

        emit NestRewardsBound(address(fwa), address(rewards), owner);
    }
}
