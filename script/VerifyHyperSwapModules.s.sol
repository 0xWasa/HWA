// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FWA} from "fwa-reference/src/FWA.sol";

import {IHyperSwapV3Factory} from "../src/hyperevm/interfaces/IHyperSwapV3.sol";
import {FWAHyperSwapAdapter} from "../src/hyperevm/FWAHyperSwapAdapter.sol";
import {FWARewardsHyperEVM} from "../src/hyperevm/FWARewardsHyperEVM.sol";
import {FWATokenHyperEVM} from "../src/hyperevm/FWATokenHyperEVM.sol";

interface VmHyperSwapVerify {
    function envAddress(string calldata name) external returns (address value);
}

contract VerifyHyperSwapModules {
    VmHyperSwapVerify internal constant vm = VmHyperSwapVerify(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant HYPEREVM_TESTNET_CHAIN_ID = 998;
    address internal constant HYPERSWAP_FACTORY = 0x22B0768972bB7f1F5ea7a8740BB8f94b32483826;
    address internal constant HYPERSWAP_ROUTER01 = 0xD81F56576B1FF2f3Ef18e9Cc71Adaa42516fD990;
    address internal constant WHYPE = 0xADcb2f358Eae6492F61A5F87eb8893d09391d160;
    bytes32 internal constant TOKEN_NAME_HASH = keccak256("Hyper World Assets");
    bytes32 internal constant TOKEN_SYMBOL_HASH = keccak256("HWA");

    event HyperSwapModulesVerified(
        address indexed token, address indexed rewards, address indexed adapter, address pool
    );

    error WrongChain(uint256 actual);
    error MissingCode(address target);
    error InvalidWiring();

    function run() external {
        if (block.chainid != HYPEREVM_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);

        FWA fwa = FWA(vm.envAddress("FWA_ADDRESS"));
        FWATokenHyperEVM token = FWATokenHyperEVM(payable(vm.envAddress("FWA_TOKEN_ADDRESS")));
        FWARewardsHyperEVM rewards = FWARewardsHyperEVM(vm.envAddress("FWA_REWARDS_ADDRESS"));
        FWAHyperSwapAdapter adapter = FWAHyperSwapAdapter(payable(vm.envAddress("FWA_HYPERSWAP_ADAPTER_ADDRESS")));
        address pool = token.pool();

        _requireCode(address(fwa));
        _requireCode(address(token));
        _requireCode(address(rewards));
        _requireCode(address(adapter));
        _requireCode(pool);

        if (
            keccak256(bytes(token.name())) != TOKEN_NAME_HASH || keccak256(bytes(token.symbol())) != TOKEN_SYMBOL_HASH
                || !token.launched() || token.totalSupply() != 1_000_000_000 ether || token.POOL_FEE() != 10_000
                || token.POOL_TICK_SPACING() != 200 || token.WHYPE() != WHYPE || token.adapter() != address(adapter)
                || token.rewardsPool() != address(rewards)
                || adapter.FACTORY() != IHyperSwapV3Factory(HYPERSWAP_FACTORY)
                || address(adapter.ROUTER()) != HYPERSWAP_ROUTER01 || address(adapter.TOKEN()) != address(token)
                || adapter.WHYPE() != WHYPE || adapter.POOL() != pool || adapter.rewardsBuyer() != address(rewards)
                || rewards.token() != address(token) || address(rewards.swapAdapter()) != address(adapter)
                || rewards.fwa() != address(fwa) || address(fwa.rewards()) != address(rewards)
                || fwa.token() != address(token)
                || IHyperSwapV3Factory(HYPERSWAP_FACTORY).getPool(WHYPE, address(token), 10_000) != pool
        ) revert InvalidWiring();

        emit HyperSwapModulesVerified(address(token), address(rewards), address(adapter), pool);
    }

    function _requireCode(address target) internal view {
        if (target.code.length == 0) revert MissingCode(target);
    }
}
