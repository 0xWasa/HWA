// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";
import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";
import {MainnetOwnerPolicy} from "./MainnetOwnerPolicy.sol";

interface VmProjectXBind {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice One-time FWA rewards binding, signed by the current core owner.
contract BindProjectXRewards {
    VmProjectXBind internal constant vm = VmProjectXBind(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant TESTNET = 998;
    uint256 internal constant MAINNET = 999;

    event ProjectXRewardsBound(address indexed fwa, address indexed rewards, address indexed owner);

    error WrongChain(uint256 actual);
    error BindingNotConfirmed();
    error UnauthorizedOwner();
    error CoreNotReady();
    error InvalidWiring();

    function run() external {
        if (block.chainid != TESTNET && block.chainid != MAINNET) revert WrongChain(block.chainid);
        if (!vm.envBool("PROJECTX_CORE_BINDING_CONFIRMED")) revert BindingNotConfirmed();
        uint256 ownerKey = vm.envUint(block.chainid == MAINNET ? "PRIVATE_KEY" : "OWNER_PRIVATE_KEY");
        address owner = vm.addr(ownerKey);
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWAHyperSwapAdapter adapter = FWAHyperSwapAdapter(payable(vm.envAddress("FWA_PROJECTX_ADAPTER_ADDRESS")));

        if (block.chainid == MAINNET) {
            MainnetOwnerPolicy.validateDeploymentOwner(fwa.owner(), owner, vm.envBool("MAINNET_EOA_OWNER_CONFIRMED"));
        } else if (fwa.owner() != owner) {
            revert UnauthorizedOwner();
        }
        if (
            address(fwa.rewards()) != address(0) || fwa.activeListingCount() != 0
                || fwa.unsettledAcquisitionCount() != 0
        ) revert CoreNotReady();
        if (
            rewards.fwa() != address(fwa) || rewards.token() != address(token)
                || address(rewards.swapAdapter()) != address(adapter) || token.rewardsPool() != address(rewards)
                || token.adapter() != address(adapter) || adapter.rewardsBuyer() != address(rewards)
        ) revert InvalidWiring();

        vm.startBroadcast(ownerKey);
        fwa.setRewards(address(rewards));
        vm.stopBroadcast();
        emit ProjectXRewardsBound(address(fwa), address(rewards), owner);
    }
}
