// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {FWANestSwapAdapter} from "../src/hyperevm/FWANestSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenNest} from "../src/hyperevm/FWATokenNest.sol";
import {SplitterHyperEVM} from "../src/hyperevm/SplitterHyperEVM.sol";
import {INestAlgebraPool} from "../src/hyperevm/interfaces/INestAlgebra.sol";

interface VmNestActivate {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envBool(string calldata name) external returns (bool value);
    function addr(uint256 privateKey) external returns (address keyAddr);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Explicit owner action to open external Nest buys after the full core/drand/Nest E2E matrix passes.
/// @dev There is no timer or automatic opening. Safe owners use PrepareMainnetOwnerActions.ps1 instead.
contract ActivateNestMarket {
    VmNestActivate internal constant vm = VmNestActivate(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    uint256 internal constant HYPEREVM_MAINNET_CHAIN_ID = 999;

    error E2ENotConfirmed();
    error TradingNotConfirmed();
    error MainnetNotConfirmed();
    error WrongChain(uint256 actual);
    error InvalidWiring();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID && block.chainid != HYPEREVM_MAINNET_CHAIN_ID) {
            revert WrongChain(block.chainid);
        }
        if (!vm.envBool("NEST_E2E_CONFIRMED")) revert E2ENotConfirmed();
        if (block.chainid == HYPEREVM_MAINNET_CHAIN_ID) {
            if (!vm.envBool("NEST_MAINNET_DEPLOYMENT_CONFIRMED")) revert MainnetNotConfirmed();
            if (!vm.envBool("NEST_PUBLIC_TRADING_CONFIRMED")) revert TradingNotConfirmed();
        }
        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenNest token = FWATokenNest(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWANestSwapAdapter adapter = FWANestSwapAdapter(payable(vm.envAddress("FWA_NEST_ADAPTER_ADDRESS")));
        SplitterHyperEVM splitter = SplitterHyperEVM(payable(vm.envAddress("FWA_SPLITTER_ADDRESS")));
        INestAlgebraPool pool = INestAlgebraPool(token.pool());
        (,,, uint8 config, uint16 communityFee,) = pool.globalState();

        if (
            token.adapter() != address(adapter) || token.rewardsPool() != address(rewards)
                || adapter.rewardsBuyer() != address(rewards) || rewards.fwa() != address(fwa)
                || address(fwa.rewards()) != address(rewards) || fwa.token() != address(token)
                || address(splitter).code.length == 0 || fwa.payoutAddress() != address(splitter)
                || splitter.ownerShareBps() != 7_000 || splitter.nftShareBps() != 3_000
                || pool.plugin() != token.plugin() || config != token.REQUIRED_PLUGIN_CONFIG()
                || pool.fee() != token.POOL_FEE() || communityFee != token.REQUIRED_COMMUNITY_FEE()
                || pool.tickSpacing() != token.POOL_TICK_SPACING() || vm.addr(ownerKey) != token.owner()
        ) revert InvalidWiring();

        vm.startBroadcast(ownerKey);
        token.setExternalBuysEnabled(true);
        vm.stopBroadcast();
    }
}
