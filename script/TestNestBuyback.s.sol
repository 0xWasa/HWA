// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWANestSwapAdapter} from "../src/hyperevm/FWANestSwapAdapter.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";

interface VmNestBuybackTest {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Executes one bounded protocol buyback while public market buys remain closed.
contract TestNestBuyback {
    VmNestBuybackTest internal constant vm = VmNestBuybackTest(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    event NestBuybackTested(
        address indexed token,
        address indexed rewards,
        address indexed adapter,
        uint256 hypeFunded,
        uint256 tokenBought,
        uint256 routedToRewards,
        uint256 burned
    );

    error WrongChain(uint256 actual);
    error TestNotConfirmed();
    error InvalidState();
    error FundingFailed();
    error VerificationFailed();

    function run() external returns (uint256 bought) {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (!vm.envBool("FWA_NEST_BUYBACK_TEST_CONFIRMED")) revert TestNotConfirmed();

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        FWATokenNest token = FWATokenNest(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWANestSwapAdapter adapter = FWANestSwapAdapter(payable(vm.envAddress("FWA_NEST_ADAPTER_ADDRESS")));
        uint256 hypeAmount = vm.envOr("FWA_NEST_BUYBACK_TEST_WEI", uint256(0.001 ether));

        if (
            hypeAmount == 0 || !token.launched() || token.externalBuysEnabled()
                || token.rewardsPool() != address(rewards) || token.adapter() != address(adapter)
                || adapter.rewardsBuyer() != address(rewards)
        ) revert InvalidState();

        uint256 supplyBefore = token.totalSupply();
        uint256 rewardsBefore = token.balanceOf(address(rewards));
        uint256 tokenBalanceBefore = token.balanceOf(address(token));

        vm.startBroadcast(deployerKey);
        (bool sent,) = address(token).call{value: hypeAmount}("");
        if (!sent) revert FundingFailed();
        bought = token.buyback();
        vm.stopBroadcast();

        uint256 supplyAfter = token.totalSupply();
        uint256 rewardsAfter = token.balanceOf(address(rewards));
        uint256 burned = supplyBefore - supplyAfter;
        uint256 routed = rewardsAfter - rewardsBefore;
        if (
            bought == 0 || burned + routed != bought || token.balanceOf(address(token)) != tokenBalanceBefore
                || address(adapter).balance != 0
        ) revert VerificationFailed();

        emit NestBuybackTested(address(token), address(rewards), address(adapter), hypeAmount, bought, routed, burned);
    }
}
